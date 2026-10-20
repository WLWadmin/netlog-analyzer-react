import type { WorkerRequest, WorkerResponse } from './protocols';
import { parseHarInput } from '../utils/parseHarInput';

it('uses the real Worker handler for recovery and resolves deferred bodies by retained ID', async () => {
  let onResult: ((message: WorkerResponse) => void) | undefined;
  const post = jest.spyOn(self, 'postMessage').mockImplementation(message => {
    if (message.type === 'success' || message.type === 'error') onResult?.(message);
  });
  const add = jest.spyOn(self, 'addEventListener');
  jest.isolateModules(() => { require('./analysisWorker'); });
  const listener = add.mock.calls.find(call => call[0] === 'message')?.[1];
  if (typeof listener !== 'function') throw new Error('Worker message handler missing');
  const send = (data: WorkerRequest) => new Promise<WorkerResponse>(resolve => {
    onResult = resolve;
    self.dispatchEvent(new MessageEvent('message', { data }));
  });
  try {
    const body = 'LARGE_BODY_'.repeat(900000);
    const entry = (text: string) => JSON.stringify({
      request: { url: 'https://example.test/body', method: 'GET' },
      response: { status: 200, content: { mimeType: 'text/plain', text } },
    });
    const raw = `{"log":{"entries":[${entry('before')},{"request":{}},{"request":{},"response":{},"time":bad},${entry(body)}]}}`;
    const expected = parseHarInput(raw);
    const response = await send({ type: 'parse-har', id: 'parse', payload: raw });
    expect(response?.type).toBe('success');
    if (response?.type !== 'success') throw new Error('HAR Worker did not succeed');
    expect(response.payload).toEqual(expected.result);
    expect(response.payload).not.toHaveProperty('repairInfo.data');
    expect(response.rawDataId).toBeDefined();
    const loaded = await send({
      type: 'get-har-response-body', id: 'body',
      payload: { rawDataId: response.rawDataId!, entryId: 1 },
    });
    expect(loaded?.type).toBe('success');
    if (loaded?.type === 'success') {
      expect(loaded.payload).toMatchObject({ state: 'available', originalLength: body.length });
      expect(JSON.stringify(loaded.payload).includes(body)).toBe(true);
    }
    const failure = await send({
      type: 'parse-har', id: 'bad', payload: '{"log":{"entries":[{"PRIVATE_FIXTURE":',
    });
    expect(failure?.type).toBe('error');
    expect(JSON.stringify(failure)).not.toContain('PRIVATE_FIXTURE');
    await send({ type: 'release-raw-data', id: 'release', payload: { rawDataId: response.rawDataId } });
  } finally {
    self.removeEventListener('message', listener);
    add.mockRestore();
    post.mockRestore();
  }
});
