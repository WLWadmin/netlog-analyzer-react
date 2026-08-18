import { TraceSourceSniffer } from './sourceSniffer';

function sniff(...chunks: string[]) {
  const sniffer = new TraceSourceSniffer();
  let result = { kind: 'pending' } as ReturnType<TraceSourceSniffer['finish']>;
  for (const chunk of chunks) result = sniffer.feed(chunk);
  return result.kind === 'pending' ? sniffer.finish() : result;
}

describe('TraceSourceSniffer', () => {
  it.each([
    ['\uFEFF  {"traceEvents":[]}', 'trace'],
    ['{"log":{"entries":[]}}', 'har'],
    ['{"constants":{},"events":[]}', 'netlog'],
    ['{"logEvents":[{"source":{"id":1},"type":1,"time":"1"}]}', 'netlog'],
    ['[{"source":{"id":1},"type":1,"time":"1"}]', 'netlog'],
  ])('detects structural source signatures', (json, source) => {
    expect(sniff(json)).toEqual({ kind: 'detected', source });
  });

  it('does not treat strings containing traceEvents as a signature', () => {
    expect(sniff('{"note":"fake traceEvents: []","metadata":{}}')).toEqual({
      kind: 'pending',
    });
  });

  it('supports keys and escape sequences split across chunks', () => {
    expect(sniff('{"tra', 'ceEv\\u006', '5nts"', ':[]')).toEqual({
      kind: 'detected',
      source: 'trace',
    });
    expect(sniff('{"log":{"ent', 'ries"', ':[]}}')).toEqual({
      kind: 'detected',
      source: 'har',
    });
  });

  it('ignores nested signatures at the wrong structural position', () => {
    expect(sniff('{"wrapper":{"traceEvents":[]},"items":[{"events":[]}] }')).toEqual({
      kind: 'pending',
    });
  });

  it('rejects unknown raw arrays and conflicting signatures in either field order', () => {
    expect(sniff(' [ {} ]')).toEqual({
      kind: 'error',
      code: 'TRACE_TOP_LEVEL_ARRAY_UNSUPPORTED',
    });
    expect(sniff('{"traceEvents":[],"events":[]}')).toEqual({
      kind: 'error',
      code: 'TRACE_SOURCE_AMBIGUOUS',
    });
    expect(sniff('{"events":[],"traceEvents":[]}')).toEqual({
      kind: 'error',
      code: 'TRACE_SOURCE_AMBIGUOUS',
    });
  });

  it('reports every detected source for safe ambiguity handling', () => {
    const sniffer = new TraceSourceSniffer();
    sniffer.feed('{"traceEvents":[],"events":[]}');

    expect(sniffer.getDetectedSources()).toEqual(['netlog', 'trace']);
  });

  it('does not retain ordinary string values', () => {
    const sniffer = new TraceSourceSniffer();
    sniffer.feed(`{"note":"${'x'.repeat(1_000_000)}","traceEvents":[]}`);

    expect(sniffer.getMetrics().maxBufferedKeyCharacters).toBeLessThan(32);
  });

  it('uses lightweight structural skipping inside traceEvents arrays', () => {
    const sniffer = new TraceSourceSniffer();
    sniffer.feed('{"traceEvents":[');
    const before = sniffer.getMetrics().fullyScannedCharacters;
    sniffer.feed(`{"args":{"data":"${'x'.repeat(100_000)}"}}`);

    expect(sniffer.getMetrics().fullyScannedCharacters - before).toBeLessThan(100);
  });

  it('does not detect nested events or traceEvents signatures', () => {
    expect(sniff(
      '{"wrapper":{"events":[]},"items":[{"traceEvents":[]}],"metadata":{}}',
    )).toEqual({ kind: 'pending' });
  });
});
