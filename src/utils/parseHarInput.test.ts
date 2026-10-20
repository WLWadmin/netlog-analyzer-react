import { parseHarInput } from './parseHarInput';
import { loadHarResponseBody } from '../components/har/harResponseBodyGateway';
import { getValueByPath } from '../parsers/shared/rawJsonPath';
import { buildHarDiagnosisSummary } from '../diagnosis/shared/fromHar';
import { buildCombinedDiagnosisSummary } from '../diagnosis/shared/fromCombined';
import { buildBaselineCompareSummary } from '../diagnosis/shared/baselineComparator';
import { compareCombinedBaselines } from '../diagnosis/shared/combinedBaselineComparator';
import { diagnoseHar } from '../harDiagnosis';
import { parseLog } from '../parsers/netlog/parser';
import { buildHarObservations } from '../diagnosis/shared/diagnosisObservation';
import { calculateHarDiagnosisCoverage } from '../diagnosis/shared/diagnosisCoverage';
import { parseUploadedInput } from '../upload/parseUploadedInput';

function entry(path: string, body: string, status = 200) {
  return {
    startedDateTime: '2026-01-01T00:00:00Z', time: 10,
    request: { url: `https://example.test/${path}`, method: 'GET', headers: [] },
    response: { status, headers: [], content: { text: body, mimeType: 'text/plain' } },
    timings: { send: 1, wait: 8, receive: 1 },
  };
}

it('maps retained IDs, field paths, original UTF-16 locations and deferred bodies consistently', async () => {
  const body = '后部内容'.repeat(3 * 1024 * 1024);
  const before = entry('before', '小响应');
  const missing = { request: { url: 'https://user:password@example.test/excluded?token=PRIVATE#fragment' } };
  const after = entry('after', body);
  const raw = JSON.stringify({ log: { comment: '中文😀', entries: [before, missing, after] } }, null, 2).replace(/\n/g, '\r\n');
  const { result, rawData } = parseHarInput(raw);
  expect(result.entries.map(item => item.id)).toEqual([0, 1]);
  expect(result.entries.map(item => item.sourceLocation?.originalEntryIndex)).toEqual([0, 2]);
  const source = result.entries[1].sourceLocation!;
  expect(JSON.parse(raw.slice(source.charStart, source.charEnd))).toEqual(after);
  const prefix = raw.slice(0, source.charStart).split('\n');
  expect(source.line).toBe(prefix.length);
  expect(source.column).toBe(prefix[prefix.length - 1].length + 1);
  expect(result.entries[1].standard.jsonPath).toBe('$.log.entries[1]');
  expect(getValueByPath(rawData, 'log.entries[1].request.url')).toBe(after.request.url);
  expect(result.entries[1].responseBodyDescriptor?.state).toBe('deferred');
  expect((await loadHarResponseBody({ rawData }, result.entries[1])).text === body).toBe(true);
  expect(result.repairInfo?.excludedEntries?.[0]).toMatchObject({
    originalEntryIndex: 1, safeUrl: 'https://example.test/excluded', urlBasis: 'parsed-request',
  });
  const report = JSON.stringify(result.repairInfo);
  for (const forbidden of ['PRIVATE', 'password', 'fragment', body.slice(0, 40)]) expect(report.includes(forbidden)).toBe(false);
  expect(result.repairInfo).not.toHaveProperty('data');
});

it('applies the same recovery and raw data mapping through the non-Worker upload entry', async () => {
  const raw = `{"log":{"entries":[${JSON.stringify(entry('before', 'first'))},{"request":{},"response":{},"time":bad},${JSON.stringify(entry('after', 'last'))}]}}`;
  const direct = parseHarInput(raw);
  const uploaded = await parseUploadedInput({ data: raw, fileTypeHint: 'har', useWorker: false });
  expect(uploaded).toEqual({ kind: 'har', ...direct });
});

it('carries missing-record boundaries into HAR, Combined, A/B and coverage', () => {
  const raw = JSON.stringify({ log: { entries: [entry('ok', '', 500), { request: {} }, entry('last', '')] } });
  const { result } = parseHarInput(raw);
  const netlog = parseLog({
    constants: {},
    events: [{ type: 1, time: '1', phase: 0, source: { id: 1, type: 1 }, params: {} }],
  }).result;
  const har = buildHarDiagnosisSummary(result, diagnoseHar(result));
  const combined = buildCombinedDiagnosisSummary(result, netlog);
  const baseline = buildBaselineCompareSummary(result, result);
  for (const summary of [har, combined, baseline]) {
    expect(summary.quality.dataIncomplete).toBe(true);
    expect(summary.cards.every(card => card.confidence !== 'high')).toBe(true);
    expect(JSON.stringify(summary.quality)).toContain('保留下来的请求');
  }
  const cards = compareCombinedBaselines({ har: result, netlog }, { har: result, netlog });
  expect(cards.every(card => card.confidence === 'low')).toBe(true);
  expect(cards.every(card => card.limitations?.some(text => text.includes('缺失请求')))).toBe(true);
  expect(calculateHarDiagnosisCoverage(result.entries, buildHarObservations(result.entries), true).denominatorMayBeIncomplete).toBe(true);
});
