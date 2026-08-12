import type { ParsedEvent } from './parser';
import { createRequestAccumulator } from './requestAccumulator';

function event(overrides: Partial<ParsedEvent>): ParsedEvent {
  return {
    time: 0,
    type: 0,
    typeName: 'UNKNOWN',
    source: { id: 0, type: 0, typeName: 'UNKNOWN_SRC' },
    phase: 0,
    phaseName: 'BEGIN',
    params: {},
    ...overrides,
  };
}

describe('createRequestAccumulator', () => {
  it('reconciles source dependencies and out-of-order lifecycle times', () => {
    const events = [
      event({
        time: 100,
        typeName: 'URL_REQUEST_START_JOB',
        source: { id: 1, type: 1, typeName: 'URL_REQUEST' },
        params: { url: 'https://example.invalid/resource', method: 'GET' },
      }),
      event({
        time: 50,
        typeName: 'HOST_RESOLVER_IMPL_JOB',
        source: { id: 2, type: 2, typeName: 'HOST_RESOLVER_IMPL_JOB' },
        phaseName: 'END',
        params: { source_dependency: { id: 1 } },
      }),
      event({
        time: 90,
        typeName: 'HTTP2_SESSION_RECV_HEADERS',
        source: { id: 3, type: 3, typeName: 'HTTP2_SESSION' },
        phaseName: 'END',
        params: { source_dependency: { id: 2 }, stream_id: 7 },
      }),
      event({
        time: 10,
        typeName: 'HOST_RESOLVER_IMPL_JOB',
        source: { id: 2, type: 2, typeName: 'HOST_RESOLVER_IMPL_JOB' },
        params: {},
      }),
      event({
        time: 80,
        typeName: 'HTTP2_SESSION_SEND_HEADERS',
        source: { id: 3, type: 3, typeName: 'HTTP2_SESSION' },
        params: { stream_id: 7 },
      }),
      event({
        time: 200,
        typeName: 'REQUEST_ALIVE',
        source: { id: 1, type: 1, typeName: 'URL_REQUEST' },
        phaseName: 'END',
        params: {},
      }),
    ];
    const fullRequestEvents: ParsedEvent[] = [];
    const accumulator = createRequestAccumulator({
      requestEventPreviewLimit: 0,
      onRequestEvent: (_request, eventIndex) => {
        fullRequestEvents.push(events[eventIndex]);
      },
    });

    events.forEach(item => accumulator.accept(item));
    const output = accumulator.finish();

    expect(output.requests).toHaveLength(1);
    const request = output.requests[0];
    expect(request.eventCount).toBe(6);
    expect(request.relatedSourceIds).toEqual([1]);
    expect(request.relatedSourceTypeNames).toEqual(['URL_REQUEST']);
    expect(request.timeline.dns?.duration).toBe(40);
    expect(request.protocol).toBe('HTTP/2');
    expect(request.lifecycleStageDurations).toMatchObject({ request: 100 });
    expect(fullRequestEvents).toEqual(events);
    expect(request.events).toEqual([]);
  });

  it('uses nested DNS query host to disambiguate a source shared by requests', () => {
    const events = [
      event({
        time: 1,
        typeName: 'URL_REQUEST_START_JOB',
        source: { id: 1, type: 1, typeName: 'URL_REQUEST' },
        params: { url: 'https://first.example.invalid/api' },
      }),
      event({
        time: 2,
        typeName: 'URL_REQUEST_START_JOB',
        source: { id: 2, type: 1, typeName: 'URL_REQUEST' },
        params: { url: 'https://second.example.invalid/api' },
      }),
      event({
        time: 3,
        typeName: 'HOST_RESOLVER_MANAGER_JOB',
        source: { id: 10, type: 2, typeName: 'HOST_RESOLVER_MANAGER_JOB' },
        params: { source_dependency: { id: 1 } },
      }),
      event({
        time: 4,
        typeName: 'HOST_RESOLVER_MANAGER_JOB',
        source: { id: 10, type: 2, typeName: 'HOST_RESOLVER_MANAGER_JOB' },
        params: { source_dependency: { id: 2 } },
      }),
      event({
        time: 5,
        typeName: 'DNS_TRANSACTION_QUERY',
        source: { id: 11, type: 3, typeName: 'DNS_TRANSACTION' },
        phaseName: 'END',
        params: {
          source_dependency: { id: 10 },
          dns_query: { hostname: 'first.example.invalid' },
        },
      }),
    ];
    const accumulator = createRequestAccumulator();
    events.forEach(item => accumulator.accept(item));

    const requests = accumulator.finish().requests;
    expect(requests.find(request => request.id === 1)?.eventCount).toBe(2);
    expect(requests.find(request => request.id === 2)?.eventCount).toBe(1);
  });
});
