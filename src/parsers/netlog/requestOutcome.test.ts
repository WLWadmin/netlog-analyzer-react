import { createRequestAccumulator } from './requestAccumulator';
import { describeRequestOutcome } from './requestOutcome';
import type { ParsedEvent } from './parser';

function event(typeName: string, phaseName: string, params: Record<string, unknown>, time: number): ParsedEvent {
  return { time, type: 1, typeName, phase: 0, phaseName,
    source: { id: 7, type: 1, typeName: 'URL_REQUEST' }, params };
}

function request(tail: ParsedEvent[]) {
  const accumulator = createRequestAccumulator({ requestEventPreviewLimit: 0 });
  [event('URL_REQUEST_START_JOB', 'BEGIN', { url: 'https://example.invalid/' }, 0), ...tail]
    .forEach(accumulator.accept);
  return accumulator.finish().requests[0];
}

describe('request outcome evidence', () => {
  it.each([
    [0, 'succeeded'], [-106, 'failed'], [-3, 'cancelled'],
    [undefined, 'unknown'], [-1, 'unknown'],
  ])('requires explicit lifetime result %s for %s', (code, state) => {
    const result = request([event('REQUEST_ALIVE', 'END', { net_error: code }, 10)]);
    expect(result.outcome).toMatchObject({ state, terminalEventId: 1 });
    expect(result.events).toEqual([]);
  });

  it('retains direct intermediate error and final success beyond preview', () => {
    const result = request([
      event('URL_REQUEST_START_JOB', 'END', { net_error: -106 }, 2),
      event('REQUEST_ALIVE', 'END', { net_error: 0 }, 10),
    ]);
    expect(result.outcome).toMatchObject({
      state: 'succeeded', directErrorCount: 1, firstErrorEventId: 1, terminalEventId: 2,
    });
    expect(describeRequestOutcome(result).label).toBe('成功（曾有错误）');
  });

  it('does not infer success from headers, a job END, or a shared socket', () => {
    const socket = event('REQUEST_ALIVE', 'END', { net_error: -106, source_dependency: { id: 7 } }, 12);
    socket.source = { id: 9, type: 2, typeName: 'SOCKET' };
    const result = request([
      event('HTTP_TRANSACTION_READ_RESPONSE_HEADERS', 'END', { status_code: 200 }, 4),
      event('URL_REQUEST_START_JOB', 'END', { net_error: 0 }, 5), socket,
    ]);
    expect(result.outcome).toMatchObject({ state: 'incomplete', directErrorCount: 0 });
    expect(describeRequestOutcome(result).label).toBe('未见结束');
  });

  it('does not overwrite a later terminal result with out-of-order events', () => {
    const result = request([
      event('REQUEST_ALIVE', 'END', { net_error: -3 }, 10),
      event('REQUEST_ALIVE', 'END', { net_error: 0 }, 5),
    ]);
    expect(result.outcome?.state).toBe('cancelled');
  });

  it.each([false, true, [], {}, ' ', -1.5])('does not treat malformed net_error %j as a result', code => {
    const result = request([event('REQUEST_ALIVE', 'END', { net_error: code }, 10)]);
    expect(result.outcome).toMatchObject({ state: 'unknown', directErrorCount: 0 });
  });
});
