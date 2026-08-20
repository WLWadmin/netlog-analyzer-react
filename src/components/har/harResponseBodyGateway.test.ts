import { parseHar, type HarRequestEntry } from '../../harParser';
import { loadHarResponseBody } from './harResponseBodyGateway';
import { getHarResponseBodyInWorker } from '../../workers/workerClient';

jest.mock('../../workers/workerClient', () => ({
  getHarResponseBodyInWorker: jest.fn(),
}));

function entry(overrides: Partial<HarRequestEntry>): HarRequestEntry {
  return {
    id: 0,
    name: 'api',
    url: 'https://example.com/api',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    protocol: 'h2',
    domain: 'example.com',
    remoteAddress: '-',
    category: 'xhr',
    rawType: 'xhr',
    mimeType: 'text/plain',
    size: 0,
    contentSize: 0,
    time: 0,
    startedDateTime: '',
    startMs: 1,
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0 },
    requestHeaders: [],
    responseHeaders: [],
    responseBody: '',
    responseEncoding: '',
    queryString: [],
    serverTiming: [],
    xTtLogid: '',
    xTtCip: '',
    xLscSourceIp: '',
    isFailed: false,
    isSlow: false,
    ...overrides,
    standard: overrides.standard ?? parseHar({
      log: { entries: [{
        request: { method: 'GET', url: 'https://example.test/', headers: [] },
        response: { status: overrides.status ?? 200, headers: [], content: {} },
        timings: { send: 0, wait: 0, receive: 0 },
      }] },
    }).entries[0].standard,
  };
}

describe('harResponseBodyGateway', () => {
  it('returns inline body without raw source', async () => {
    await expect(loadHarResponseBody({}, entry({
      responseBody: 'inline',
      responseBodyDescriptor: { state: 'inline', originalLength: 6, mimeType: 'text/plain' },
    }))).resolves.toEqual({
      state: 'available',
      text: 'inline',
      encoding: '',
      mimeType: 'text/plain',
      originalLength: 6,
    });
  });

  it('loads deferred body from main-thread rawData fallback', async () => {
    const rawData = { log: { entries: [{ response: { content: { text: 'raw-body', encoding: '', mimeType: 'text/plain' } } }] } };

    await expect(loadHarResponseBody({ rawData }, entry({
      responseBodyDescriptor: { state: 'deferred', originalLength: 8, mimeType: 'text/plain' },
    }))).resolves.toMatchObject({
      state: 'available',
      text: 'raw-body',
      mimeType: 'text/plain',
    });
  });

  it('loads deferred body from worker rawDataId', async () => {
    (getHarResponseBodyInWorker as jest.Mock).mockResolvedValueOnce({
      state: 'available',
      text: 'worker-body-2',
      encoding: '',
      mimeType: 'text/plain',
      originalLength: 13,
    });

    await expect(loadHarResponseBody({ rawDataId: 'raw-1' }, entry({
      id: 2,
      responseBodyDescriptor: { state: 'deferred', originalLength: 13, mimeType: 'text/plain' },
    }))).resolves.toMatchObject({
      state: 'available',
      text: 'worker-body-2',
    });
  });

  it('rejects out-of-range main-thread entryId without leaking URL', async () => {
    const rawData = { log: { entries: [] } };

    await expect(loadHarResponseBody({ rawData }, entry({
      id: 3,
      responseBodyDescriptor: { state: 'deferred', originalLength: 1 },
    }))).rejects.toThrow('entryId 越界');
  });
});
