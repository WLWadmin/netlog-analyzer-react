import { Worker as NodeWorker } from 'worker_threads';
import path from 'path';
import type { WorkerRequest, WorkerResponse } from './protocols';

// Load the production handler in a separate thread. Only the Web Worker/File
// host API is adapted; parser, indexer and response serialization stay real.
function startWorker() {
  const worker = new NodeWorker(`
    const { parentPort, workerData } = require('worker_threads');
    const { File } = require('buffer');
    const fs = require('fs');
    const ts = require(workerData.typescript);
    require.extensions['.ts'] = (module, filename) => {
      const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
      }).outputText;
      module._compile(output, filename);
    };
    global.File = File;
    global.self = {
      postMessage: data => parentPort.postMessage(data),
      addEventListener: (type, listener) => parentPort.on('message', envelope => {
        const data = envelope.request;
        if (envelope.text !== undefined) {
          const file = new File([envelope.text], 'synthetic.json');
          if (data.type === 'import-netlog-dataset') data.payload.file = file;
          else data.payload = { file, singleScanDataset: envelope.singleScanDataset };
          if (envelope.blocked) {
            data.payload.stream = new ReadableStream({
              start(controller) { controller.enqueue(new TextEncoder().encode(envelope.text)); },
              async cancel() {
                await new Promise(resolve => setTimeout(resolve, 20));
                parentPort.postMessage({ type: 'reader-cancelled', id: data.id });
              }
            });
          } else if (envelope.burst) {
            const bytes = new TextEncoder().encode(envelope.text);
            data.payload.stream = new ReadableStream({
              start(controller) {
                for (let offset = 0; offset < bytes.length; offset += 4096) {
                  controller.enqueue(bytes.slice(offset, offset + 4096));
                }
                controller.close();
              }
            });
          }
        }
        listener({ data });
      })
    };
    require(workerData.entry);
    parentPort.postMessage({ type: 'ready' });
  `, {
    eval: true,
    workerData: {
      typescript: require.resolve('typescript'),
      entry: path.join(__dirname, 'analysisWorker.ts'),
    },
  });
  const messages: Array<WorkerResponse | { type: 'reader-cancelled'; id: string }> = [];
  const waiters = new Set<() => void>();
  worker.on('message', message => {
    messages.push(message);
    waiters.forEach(notify => notify());
  });
  const waitFor = (predicate: (message: typeof messages[number]) => boolean) =>
    new Promise<typeof messages[number]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker response missing')), 10000);
      const notify = () => {
        const message = messages.find(predicate);
        if (!message) return;
        clearTimeout(timer);
        waiters.delete(notify);
        resolve(message);
      };
      waiters.add(notify);
      notify();
    });
  return {
    worker, messages, waitFor,
    ready: new Promise<void>(resolve => {
      worker.on('message', message => { if (message.type === 'ready') resolve(); });
    }),
    send: (request: WorkerRequest, fixture?: { text: string; singleScanDataset?: boolean; blocked?: boolean; burst?: boolean }) =>
      worker.postMessage({ request, ...fixture }),
  };
}

it.each([true, false])('preserves fatal quality and field location across the Worker boundary (single scan: %s)', async singleScanDataset => {
  const host = startWorker();
  try {
    await host.ready;
    host.send({ type: 'parse-large-netlog-file', id: 'damaged', payload: new File([], 'synthetic.json') }, {
      text: '{"constants":{"logEventTypes":},"events":[]}', singleScanDataset,
    });
    const message = await host.waitFor(message => message.id === 'damaged' && message.type === 'error');
    expect(message).toMatchObject({
      type: 'error',
      qualityReport: {
        format: 'netlog', status: 'fatal',
        issues: expect.arrayContaining([expect.objectContaining({
          severity: 'fatal', samples: expect.arrayContaining([expect.objectContaining({ jsonPath: '$.constants' })]),
        })]),
      },
    });
  } finally {
    await host.worker.terminate();
  }
}, 20000);

it('cancels a blocked reader and confirms settlement while another Dataset and task remain usable', async () => {
  const host = startWorker();
  try {
    await host.ready;
    host.send({ type: 'import-netlog-dataset', id: 'existing', payload: { file: new File([], 'synthetic.json') } }, { text: '{"events":[]}' });
    const existing = await host.waitFor(message => message.id === 'existing' && message.type === 'success');
    if (existing.type !== 'success') throw new Error('Dataset missing');
    const meta = existing.payload as { analysisId: string };
    host.send({ type: 'parse-large-netlog-file', id: 'blocked', payload: new File([], 'synthetic.json') }, {
      text: '{"events":[', singleScanDataset: true, blocked: true,
    });
    await host.waitFor(message => message.id === 'blocked' && message.type === 'progress');
    host.send({ type: 'cancel-task', id: 'cancel', payload: { taskId: 'blocked' } });
    host.send({ type: 'parse-har', id: 'other', payload: '{"log":{"entries":[]}}' });
    await host.waitFor(message => message.type === 'reader-cancelled');
    expect(await host.waitFor(message => message.id === 'cancel' && message.type !== 'progress')).toMatchObject({
      type: 'cancelled', taskId: 'blocked',
    });
    expect(host.messages.findIndex(message => message.id === 'cancel')).toBeGreaterThan(
      host.messages.findIndex(message => message.type === 'reader-cancelled'),
    );
    expect(await host.waitFor(message => message.id === 'other' && message.type !== 'progress')).toMatchObject({ type: 'success' });
    host.send({ type: 'get-netlog-data-loaded', id: 'query', payload: { analysisId: meta.analysisId } });
    expect(await host.waitFor(message => message.id === 'query' && message.type !== 'progress')).toMatchObject({ type: 'success' });
    expect(host.messages.some(message => message.id === 'blocked' && message.type === 'success')).toBe(false);
  } finally {
    await host.worker.terminate();
  }
}, 20000);

it('services cancellation while immediately available chunks are still being indexed', async () => {
  const host = startWorker();
  try {
    await host.ready;
    host.send({ type: 'parse-large-netlog-file', id: 'burst', payload: new File([], 'synthetic.json') }, {
      text: `{"constants":{"logEventTypes":{"REQUEST_ALIVE":1},"logSourceType":{"URL_REQUEST":1}},"events":[${Array.from({ length: 50000 }, (_, id) => JSON.stringify({
        time: String(id), type: 1, source: { id, type: 1 }, phase: 0, params: {},
      })).join(',')}]}`,
      singleScanDataset: true, burst: true,
    });
    await host.waitFor(message => message.id === 'burst' && message.type === 'progress');
    host.send({ type: 'cancel-task', id: 'cancel-burst', payload: { taskId: 'burst' } });
    expect(await host.waitFor(message => message.id === 'cancel-burst')).toMatchObject({ type: 'cancelled' });
    expect(host.messages.some(message => message.id === 'burst' && message.type === 'success')).toBe(false);
    expect(host.messages.some(message => message.id === 'burst' && message.type === 'error')).toBe(false);
  } finally {
    await host.worker.terminate();
  }
}, 20000);
