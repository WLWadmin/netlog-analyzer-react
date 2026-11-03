import { readFileSync } from 'fs';
import path from 'path';
import ts from 'typescript';
import type * as Client from './workerClient';
import type { WorkerResponse } from './protocols';
import { FileQualityError } from '../parsers/shared/fileQuality';

class TestWorker {
  postMessage = jest.fn();
  terminate = jest.fn();
  private listener?: (event: MessageEvent<WorkerResponse>) => void;
  addEventListener(type: string, listener: (event: MessageEvent<WorkerResponse>) => void) {
    if (type === 'message') this.listener = listener;
  }
  emit(data: WorkerResponse) {
    this.listener?.(new MessageEvent('message', { data }));
  }
}

function loadClient(worker: TestWorker): typeof Client {
  // Jest cannot evaluate webpack's import.meta.url. Replace only its URL host;
  // the production dispatcher and public API execute unchanged.
  const source = readFileSync(path.join(__dirname, 'workerClient.ts'), 'utf8')
    .replace(/import\.meta\.url/g, "'file:///synthetic/workerClient.ts'");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports: Partial<typeof Client> = {};
  // Execute this local transpiled CommonJS fixture with its injected Worker.
  // eslint-disable-next-line no-new-func
  new Function('require', 'exports', 'Worker', compiled)(require, exports, function () { return worker; });
  return exports as typeof Client;
}

afterEach(() => jest.useRealTimers());

it('cancels only the timed-out task, accepts confirmation and releases late Dataset and raw cache results', async () => {
  jest.useFakeTimers();
  const worker = new TestWorker();
  const client = loadClient(worker);
  try {
    const timedOut = client.parseHarInWorker('{"log":{"entries":[]}}', undefined, { timeout: 10 });
    const rejected = (async () => {
      await expect(timedOut).rejects.toThrow('Worker timeout');
    })();
    const expiredId = worker.postMessage.mock.calls[0][0].id;
    const other = client.parseHarInWorker('{"log":{"entries":[]}}', undefined, { timeout: 100 });
    void other.catch(() => undefined); // Keep failure cleanup from causing an unhandled rejection.
    const otherId = worker.postMessage.mock.calls[1][0].id;
    jest.advanceTimersByTime(10);
    await rejected;
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'cancel-task', payload: { taskId: expiredId },
    }));
    const cancel = worker.postMessage.mock.calls.find(([request]) => request.type === 'cancel-task')?.[0];
    worker.emit({ type: 'success', id: expiredId, resultType: 'netlog', payload: {},
      rawDataId: 'orphan-raw', datasetMeta: { analysisId: 'orphan-dataset', fileName: '', fileSize: 0, fileType: '', importedAt: 0, status: 'ready' }, duration: 0 });
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'release-netlog-dataset', payload: { analysisId: 'orphan-dataset' },
    }));
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'release-raw-data', payload: { rawDataId: 'orphan-raw' },
    }));
    worker.emit({ type: 'cancelled', id: cancel.id, taskId: expiredId });
    worker.emit({ type: 'success', id: otherId, resultType: 'har', payload: { entries: [] }, duration: 0 });
    await expect(other).resolves.toMatchObject({ result: { entries: [] } });
    expect(worker.terminate).not.toHaveBeenCalled();
    // A success queued before cancellation confirmation may arrive afterwards.
    worker.emit({ type: 'success', id: expiredId, resultType: 'netlog-dataset', payload: { analysisId: 'late-dataset' }, duration: 0 });
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'release-netlog-dataset', payload: { analysisId: 'late-dataset' },
    }));
    const releasesBeforeQuery = worker.postMessage.mock.calls.filter(([request]) =>
      request.type === 'release-netlog-dataset',
    ).length;
    worker.emit({ type: 'success', id: expiredId, resultType: 'netlog-data-loaded',
      payload: { analysisId: 'shared-dataset' }, duration: 0 });
    expect(worker.postMessage.mock.calls.filter(([request]) =>
      request.type === 'release-netlog-dataset',
    )).toHaveLength(releasesBeforeQuery);
  } finally {
    client.terminateWorker();
  }
});

it('reconstructs FileQualityError from a structured error message', async () => {
  const worker = new TestWorker();
  const client = loadClient(worker);
  try {
    const task = client.parseHarInWorker('{}');
    const id = worker.postMessage.mock.calls[0][0].id;
    worker.emit({ type: 'error', id, error: 'Invalid file', qualityReport: {
      format: 'har', status: 'fatal', scope: 'partial', issues: [], checkedRecords: 0,
    } });
    await expect(task).rejects.toBeInstanceOf(FileQualityError);
  } finally {
    client.terminateWorker();
  }
});
