import { parseHar } from '../harParser';
import { parseLogFile } from '../logParser';
import { parseLog } from '../parsers/netlog';

describe('parser record progress', () => {
  it('reports real NetLog event counts', () => {
    const onProgress = jest.fn();

    parseLog({
      constants: {
        logEventTypes: { REQUEST_ALIVE: 1 },
        logSourceType: { URL_REQUEST: 1 },
      },
      events: [
        { time: '1', type: 1, phase: 0, source: { id: 1, type: 1 }, params: {} },
        { time: '2', type: 1, phase: 2, source: { id: 1, type: 1 }, params: {} },
      ],
    }, onProgress);

    expect(onProgress).toHaveBeenLastCalledWith(2, 2);
  });

  it('reports real HAR request counts', () => {
    const onProgress = jest.fn();

    parseHar({
      log: {
        entries: [
          {
            startedDateTime: '2026-01-01T00:00:00.000Z',
            time: 1,
            request: { method: 'GET', url: 'https://example.invalid/', headers: [] },
            response: { status: 200, headers: [], content: {} },
            timings: {},
          },
        ],
      },
    }, onProgress);

    expect(onProgress).toHaveBeenLastCalledWith(1, 1);
  });

  it('reports real Go Log line counts', () => {
    const onProgress = jest.fn();

    parseLogFile([
      '[worker-1] Info GET:https://example.invalid/ +10ms',
      '[worker-1] Error GET:https://example.invalid/ +20ms',
    ].join('\n'), onProgress);

    expect(onProgress).toHaveBeenLastCalledWith(2, 2);
  });
});
