import { buildSourceGraph } from './sourceGraph';
import type { ParsedEvent, URLRequest } from './parser';

function evt(partial: Partial<ParsedEvent>): ParsedEvent {
  return {
    time: 0,
    type: 0,
    typeName: 'UNKNOWN',
    source: { id: 0, type: 0, typeName: 'UNKNOWN' },
    phase: 0,
    phaseName: 'NONE',
    params: {},
    ...partial,
  };
}

describe('sourceGraph', () => {
  test('buildSourceGraph should build chains from source_dependency', () => {
    const urlRequests: URLRequest[] = [
      {
        id: 1,
        url: 'https://example.com/api',
        method: 'GET',
        startTime: 100,
        events: [],
        timeline: {},
      },
    ];

    const events: ParsedEvent[] = [
      evt({
        time: 100,
        typeName: 'URL_REQUEST_START_JOB',
        source: { id: 1, type: 0, typeName: 'URL_REQUEST' },
        params: { source_dependency: { id: 2 } },
      }),
      evt({
        time: 110,
        typeName: 'HTTP_STREAM_JOB_CONTROLLER_BOUND',
        source: { id: 2, type: 0, typeName: 'HTTP_STREAM_JOB' },
        params: { source_dependency: { id: 3 } },
      }),
      evt({
        time: 120,
        typeName: 'SOCKET_ALIVE',
        source: { id: 3, type: 0, typeName: 'SOCKET' },
        params: { net_error: -105 },
      }),
    ];

    const graph = buildSourceGraph(events, urlRequests);
    expect(graph.roots).toEqual([1]);
    const chain = graph.chains.find(c => c.rootId === 1);
    expect(chain).toBeTruthy();
    expect(chain!.path.map(n => n.id)).toEqual([1, 2, 3]);
    expect(chain!.hasError).toBe(true);
  });
});

