import { classifyParsedTraceSource } from './guards';

describe('classifyParsedTraceSource', () => {
  it('accepts an object-wrapped Chromium Trace', () => {
    expect(classifyParsedTraceSource({ traceEvents: [{ name: 'RunTask' }] })).toEqual({
      kind: 'trace',
      trace: { traceEvents: [{ name: 'RunTask' }] },
      skippedEventCount: 0,
    });
  });

  it('rejects raw top-level arrays', () => {
    expect(classifyParsedTraceSource([])).toEqual({
      kind: 'error',
      code: 'TRACE_TOP_LEVEL_ARRAY_UNSUPPORTED',
    });
  });

  it.each([
    [{ traceEvents: [] }, 'trace'],
    [{ log: { entries: [] } }, 'har'],
    [{ events: [], constants: {} }, 'netlog'],
  ])('classifies JSON structures without relying on extensions', (value, source) => {
    const result = classifyParsedTraceSource(value);
    expect(result.kind === 'trace' ? 'trace' : result.kind === 'detected-source' ? result.source : 'error')
      .toBe(source);
  });

  it('returns unknown and ambiguous errors separately', () => {
    expect(classifyParsedTraceSource({ metadata: {} })).toEqual({
      kind: 'error',
      code: 'TRACE_SOURCE_UNKNOWN',
    });
    expect(classifyParsedTraceSource({ traceEvents: [], events: [] })).toEqual({
      kind: 'error',
      code: 'TRACE_SOURCE_AMBIGUOUS',
    });
  });

  it('enforces the event limit and preserves original indexes for non-object values', () => {
    expect(classifyParsedTraceSource({ traceEvents: [{}, {}] }, 1)).toEqual({
      kind: 'error',
      code: 'TRACE_EVENT_LIMIT_EXCEEDED',
    });
    expect(classifyParsedTraceSource({ traceEvents: [{ ts: 1 }, null, 3] })).toEqual({
      kind: 'trace',
      trace: { traceEvents: [{ ts: 1 }, {}, {}] },
      skippedEventCount: 2,
    });
  });
});
