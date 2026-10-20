import { parseHarWithRepair } from './harRepair';
import { parseHar } from '../harParser';

const entry = (path = '/ok') => ({
  request: { url: `https://example.test${path}`, method: 'GET' },
  response: { status: 200, content: { text: 'ok' } },
});
const har = (entries: unknown[]) => ({ log: { version: '1.2', entries } });

describe('HAR recovery: format and structure isolation', () => {
  it('keeps valid HAR output unchanged, including an empty entries array', () => {
    for (const data of [har([entry()]), har([])]) {
      const result = parseHarWithRepair(JSON.stringify(data));
      expect(result.repaired).toBe(false);
      expect(parseHar(result.data)).toEqual(parseHar(data));
    }
  });

  it.each([undefined, null, [], 'invalid', 1])('isolates invalid response %p', response => {
    const data = har([entry('/before'), { ...entry(), response }, entry('/after')]);
    expect(() => parseHar(data)).toThrow('缺少 request 或 response');
    const result = parseHarWithRepair(JSON.stringify(data));
    expect(result).toMatchObject({ recoveredEntries: 2, droppedEntries: 1 });
    expect(parseHar(result.data).entries.map(item => item.name)).toEqual(['before', 'after']);
  });

  it.each([undefined, null, [], 'invalid', 1])('isolates invalid request %p', request => {
    const result = parseHarWithRepair(JSON.stringify(har([{ request, response: {} }, entry()])));
    expect(result).toMatchObject({ recoveredEntries: 1, droppedEntries: 1 });
  });

  it.each([
    { wrapper: har([entry()]) },
    { entries: [entry()] },
    { log: { nested: { entries: [entry()] } } },
  ])('rejects non-root HAR, valid or damaged', data => {
    const raw = JSON.stringify(data);
    expect(() => parseHarWithRepair(raw)).toThrow();
    expect(() => parseHarWithRepair(raw.slice(0, -1))).toThrow();
  });

  it('preserves format conflict checks', () => {
    expect(() => parseHarWithRepair(JSON.stringify({ ...har([entry()]), traceEvents: [] })))
      .toThrow('其他诊断格式');
  });

  it('does not return empty success for exclusively incomplete records', () => {
    expect(() => parseHarWithRepair(JSON.stringify(har([{ request: {} }]))))
      .toThrow('结构不完整');
  });
});

describe('HAR recovery: independent records and bounded scanning', () => {
  const good = JSON.stringify(entry());
  const damaged = '{"request":{},"response":{}, "time":invalid}';
  const document = (items: string[]) => `{"log":{"entries":[${items.join(',')}]}}`;

  it.each([0, 2])('preserves both sides of %i consecutive damaged records', extra => {
    const result = parseHarWithRepair(document([good, damaged, ...Array(extra).fill(damaged), good]));
    expect(result).toMatchObject({
      recoveredEntries: 2, syntaxDamagedEntries: 1 + extra,
      totalEntries: 3 + extra, totalEntriesExact: true,
    });
    expect(result.retainedSources?.map(source => source.originalEntryIndex)).toEqual([0, extra + 2]);
  });

  it('handles formatted JSON and preserves metadata following entries', () => {
    const raw = JSON.stringify({ log: { entries: [entry(), { ...entry(), time: 'BAD' }, entry()], version: '1.2' } }, null, 2)
      .replace('"BAD"', 'invalid');
    const result = parseHarWithRepair(raw);
    expect(result.recoveredEntries).toBe(2);
    expect(result.data).toMatchObject({ log: { version: '1.2' } });
  });

  it.each([']}}', '}}', '}'])('retains complete entries with missing outer suffix %s', suffix => {
    const raw = document([good]);
    const result = parseHarWithRepair(raw.slice(0, -suffix.length));
    expect(result.recoveredEntries).toBe(1);
    expect(parseHar(result.data).entries[0].responseBody).toBe('ok');
  });

  it.each([
    '{"request":{',
    '{"request":{},"response":{"content":{"text":"unfinished',
    '{"request":{},"response":{"content":{"text":"unfinished\n{"request":{},"response":{}}',
  ])('never invents a truncated response or promotes embedded text', tail => {
    const result = parseHarWithRepair(`{"log":{"entries":[${good},${tail}`);
    expect(result).toMatchObject({ recoveredEntries: 1, totalEntriesExact: false, recoveryRate: 0, unknownRanges: 1 });
    expect(result.reason).toContain('至少恢复');
  });

  it('does not interpret response text or escaped HAR fragments as requests', () => {
    const text = 'quote:" slash:\\ braces:{}[] newline:\n {"request":{},"response":{},"entries":[]}';
    const embedded = JSON.stringify({ ...entry(), response: { content: { text }, status: 200 } });
    const result = parseHarWithRepair(document([embedded, damaged, good]));
    expect(result).toMatchObject({ recoveredEntries: 2, totalEntries: 3 });
    expect(parseHar(result.data).entries[0].responseBody).toBe(text);
  });

  it('isolates mismatched delimiters as an uncounted range', () => {
    const result = parseHarWithRepair(document([good, '{"request":{},"response":{}]', good]));
    expect(result).toMatchObject({ recoveredEntries: 2, totalEntriesExact: false, heuristicResynchronization: true });
    expect(result.retainedSources?.[1].originalEntryIndex).toBeUndefined();
  });

  it('isolates surplus brackets in an extension using intact terminal members and a valid sibling', () => {
    const broken = {
      _initiator: { stack: { callFrames: [{ functionName: 'MARK' }] } },
      ...entry('/damaged'),
    };
    const raw = JSON.stringify(har([entry('/before'), broken, entry('/after')]), null, 2)
      .replace('"functionName": "MARK"', '"functionName": "MARK"} } ] } }');
    const result = parseHarWithRepair(raw);
    expect(result).toMatchObject({
      recoveredEntries: 2, syntaxDamagedEntries: 1, totalEntries: 3,
      totalEntriesExact: true, heuristicResynchronization: true, unknownRanges: 0,
    });
    expect(result.excludedEntries?.[0].originalEntryIndex).toBe(1);
    expect(result.retainedSources?.map(item => item.originalEntryIndex)).toEqual([0, 2]);
  });

  it('does not use indented request-shaped body text as a terminal member sequence', () => {
    const damagedText = '"unfinished\n        \\"request\\": {},\n        \\"response\\": {}\n      },';
    const result = parseHarWithRepair(`{"log":{"entries":[${good},\n      {\n        "response":{"content":{"text":${damagedText}\n      ${good}]}}`);
    expect(result).toMatchObject({ recoveredEntries: 1, totalEntriesExact: false, unknownRanges: 1 });
  });

  it('validates only the final member sequence when a corrupted extension repeats request fields', () => {
    const raw = `{"log":{"entries":[
      ${good},
      {
        "_initiator": { "stack": {} ] } },
        "request": {},
        "response": {},
        "invalid": bad,
        "request": {},
        "response": {}
      },
      ${good}
    ]}}`;
    expect(parseHarWithRepair(raw)).toMatchObject({
      recoveredEntries: 2, syntaxDamagedEntries: 1, totalEntries: 3,
      totalEntriesExact: true, heuristicResynchronization: true,
    });
  });

  it('rejects competing root formats before or after damaged HAR entries', () => {
    for (const raw of [
      `{"traceEvents":[],"log":{"entries":[${good},${damaged}]}}`,
      `{"log":{"entries":[${good},${damaged}]},"traceEvents":[]}`,
      `{"log":{"entries":[${good},${damaged}]},"constants":{},"events":[]}`,
    ]) expect(() => parseHarWithRepair(raw)).toThrow('其他诊断格式');
  });

  it('does not expose engine syntax errors or secret values', () => {
    const secret = 'PRIVATE_FIXTURE_VALUE';
    const result = parseHarWithRepair(document([good, `{"request":{},"response":{}, "${secret}":${secret}}`]));
    const { data, ...report } = result;
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(() => parseHarWithRepair(`{"log":{"entries":[${secret}`)).toThrow('无法可靠恢复');
  });

  it('rejects empty damaged documents and non-object records without inventing requests', () => {
    expect(() => parseHarWithRepair('{"log":{"entries":[')).toThrow('无可用请求');
    const result = parseHarWithRepair(document(['null', '[]', '"text"', good]));
    expect(result).toMatchObject({ recoveredEntries: 1, structureIncompleteEntries: 3 });
  });

  it('never rounds a known partial recovery up to 100 percent', () => {
    const result = parseHarWithRepair(document([...Array(999).fill(good), damaged]));
    expect(result.recoveryRate).toBe(99.9);
  });

  it.each([false, true])('keeps recovery cost proportional across body sizes (resync=%s)', resync => {
    const measure = (size: number) => {
      const broken = {
        _initiator: { marker: 'MARK' }, request: {},
        response: { content: { text: 'x'.repeat(size) } },
      };
      const raw = resync ? JSON.stringify(har([entry(), broken, entry()]), null, 2)
        .replace('"marker": "MARK"', '"marker": "MARK"} ] } }')
        : document([
        JSON.stringify({ ...entry(), response: { content: { text: 'x'.repeat(size) } } }),
        damaged, good,
      ]);
      const times: number[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const started = performance.now();
        const result = parseHarWithRepair(raw);
        times.push(performance.now() - started);
        expect(result.recoveredEntries).toBe(2);
        if (resync) expect(result.heuristicResynchronization).toBe(true);
      }
      return Math.min(...times);
    };
    const times = [1, 4, 16].map(mb => measure(mb * 1024 * 1024));
    // Four times the input permits scheduling/GC noise but not repeated suffix
    // searches (quadratic work). Absolute slack covers very fast small runs.
    expect(times[1]).toBeLessThan(times[0] * 10 + 200);
    expect(times[2]).toBeLessThan(times[1] * 10 + 200);
  }, 30000);
});
