import { parseHar } from '../../harParser';
import { buildBaselineCompareSummary, compareBaselines } from './baselineComparator';
import { buildIncidentEpisodes } from './incidentEpisode';
import { calculateImpactScope } from './impactScope';

function harEntry(path: string, overrides: Record<string, any> = {}) {
  return {
    startedDateTime: '2026-07-12T00:00:00.000Z',
    time: overrides.time ?? 100,
    request: {
      method: overrides.method || 'GET',
      url: `https://api.example.test${path}?token=SECRET_QUERY`,
      headers: [],
      cookies: [],
      queryString: [{ name: 'token', value: 'SECRET_QUERY' }],
    },
    response: {
      status: overrides.status ?? 200,
      statusText: overrides.statusText || 'OK',
      httpVersion: overrides.protocol || 'HTTP/2',
      headers: overrides.headers || [],
      cookies: [],
      content: { size: 0, mimeType: 'application/json', text: '' },
      _fromCache: overrides.fromCache,
    },
    timings: overrides.timings || { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 98, receive: 1 },
  };
}

function parse(entries: Record<string, any>[]) {
  return parseHar({
    log: {
      version: '1.2',
      creator: { name: 'Synthetic', version: '1.0' },
      entries,
    },
  });
}

describe('baselineComparator', () => {
  it('counts all thirty-five requests sharing one changed request key', () => {
    const baseline = parse([harEntry('/repeated')]);
    const current = parse(Array.from({ length: 35 }, () => harEntry('/repeated', { status: 500, protocol: 'HTTP/1.1', fromCache: 'disk' })));
    const cards = compareBaselines(baseline, current);
    for (const id of ['baseline-status-class-changes', 'baseline-protocol-changes', 'baseline-cache-source-changes']) {
      const card = cards.find(item => item.id === id);
      expect(card?.relatedRequestIds).toHaveLength(35);
      expect(card?.scope.affectedRequestCount).toBe(35);
    }
  });
  it('retains all twelve new problem hosts when the common host does not regress', () => {
    const baseline = parse([harEntry('/common')]);
    const current = parse([harEntry('/common'), ...Array.from({ length: 12 }, (_, index) => ({
      ...harEntry('/failure', { status: 500 }),
      request: { url: `https://new-${index}.example.test/failure` },
    }))]);
    const cards = compareBaselines(baseline, current);
    const added = cards.find(item => item.id === 'baseline-current-only-hosts');
    expect(added?.title).toContain('12 个');
    expect(added?.scope.affectedDomainCount).toBe(12);
    expect(added?.relatedRequestIds).toHaveLength(12);
    expect(cards.some(item => item.id === 'baseline-no-regression')).toBe(false);
  });

  it('preserves all thirty-five affected IDs through episode and impact aggregation', () => {
    const baseline = parse(Array.from({ length: 35 }, (_, index) => harEntry(`/item-${index}`)));
    const current = parse(Array.from({ length: 35 }, (_, index) => harEntry(`/item-${index}`, { time: 5000 })));
    const card = compareBaselines(baseline, current).find(item => item.id.startsWith('baseline-diff-'))!;
    expect(card.relatedRequestIds).toHaveLength(35);
    expect(calculateImpactScope({ cards: [card] }).affectedRequestCount).toBe(35);
    expect(buildIncidentEpisodes([card])[0].affectedRequestCount).toBe(35);
  });

  it('does not discard the eleventh and twelfth regressing domains', () => {
    const entries = (time: number) => Array.from({ length: 12 }, (_, index) => ({
      ...harEntry('/item', { time }),
      request: { url: `https://host-${index}.example.test/item` },
    }));
    expect(compareBaselines(parse(entries(100)), parse(entries(5000)))
      .filter(item => item.id.startsWith('baseline-diff-'))).toHaveLength(12);
  });
  it('lowers confidence for Waiting coverage 6/6 versus 1/6 despite complete time', () => {
    const baseline = parse(Array.from({ length: 6 }, (_, index) => harEntry(`/phase-${index}`, {
      time: 100, timings: { send: 0, wait: 100, receive: 0 },
    })));
    const current = parse(Array.from({ length: 6 }, (_, index) => harEntry(`/phase-${index}`, {
      time: 1000, timings: { send: 0, wait: index === 0 ? 1000 : undefined, receive: 0 },
    })));
    const card = compareBaselines(baseline, current).find(item => item.id.startsWith('baseline-diff-'));
    expect(card?.confidence).toBe('low');
    expect(card?.evidence.find(item => item.label === '阶段退化 1')?.value).toContain('正常 6/6；异常 1/6');
    expect(card?.limitations?.join(' ')).toContain('仅基于部分请求');
    expect(card?.evidence.find(item => item.label === '耗时覆盖度')?.value).toContain('仅指 time');
  });

  it.each(['both', 'current'])('explicitly reports no comparable durations when %s samples have no known durations', side => {
    const known = [harEntry('/a'), harEntry('/b')];
    const unknown = known.map(item => ({ ...item, time: undefined }));
    const card = compareBaselines(parse(side === 'both' ? unknown : known), parse(unknown))[0];
    expect(card).toMatchObject({ id: 'baseline-timing-incomplete', confidence: 'low' });
    expect(card.conclusion).toContain('无可比较耗时');
    expect(card.conclusion).toContain('无法比较');
    expect(card.conclusion).not.toContain('未发现');
    expect(card.scope.summary).toContain('无可比较耗时');
  });

  it.each([200, 500])('detects known 5000ms regression despite a missing duration (status %i)', status => {
    const baseline = parse([harEntry('/a'), harEntry('/b')]);
    const current = parse([
      harEntry('/a', { time: 5000 }),
      { ...harEntry('/b', { status }), time: undefined },
    ]);
    const card = compareBaselines(baseline, current).find(item => item.id.startsWith('baseline-diff-'));
    expect(card).toMatchObject({ title: 'api.example.test 耗时退化 4900%', confidence: 'low' });
    expect(card?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '正常样本平均耗时', value: '100ms' }),
      expect.objectContaining({ label: '异常样本平均耗时', value: '5000ms' }),
      expect.objectContaining({ label: '耗时覆盖度', value: '正常 2/2 (100%)；异常 1/2 (50%)；仅指 time，不代表全阶段覆盖' }),
    ]));
    expect(JSON.stringify(card)).not.toContain('NaN');
  });

  it.each([undefined, -1, 'bad', Infinity])('cannot compare all unknown current durations (%s)', time => {
    const baseline = parse([harEntry('/a'), harEntry('/b')]);
    const current = parse([harEntry('/a'), harEntry('/b')].map(entry => ({ ...entry, time })));
    expect(compareBaselines(baseline, current)[0]).toMatchObject({
      id: 'baseline-timing-incomplete', confidence: 'low', title: '正常/异常样本耗时无法完整比较',
    });
  });

  it('limits no-regression confidence and summary confidence for partially covered durations', () => {
    const entries = Array.from({ length: 6 }, (_, index) => harEntry(`/item-${index}`));
    const baseline = parse(entries);
    const current = parse(entries.map((entry, index) => ({ ...entry, time: index === 0 ? undefined : 100 })));
    const summary = buildBaselineCompareSummary(baseline, current);
    expect(summary.cards[0]).toMatchObject({ id: 'baseline-timing-incomplete', confidence: 'low' });
    expect(summary.combinedConfidence).toBe('low');
    expect(summary.quality.issues.some(issue => issue.message.includes('耗时'))).toBe(true);
  });

  it('keeps failures observable without inventing duration differences or missing phase baselines', () => {
    const baseline = parse([{ ...harEntry('/a'), time: undefined, timings: {} }]);
    const current = parse([{ ...harEntry('/a', { status: 500 }), time: undefined }]);
    const card = compareBaselines(baseline, current).find(item => item.id.startsWith('baseline-diff-'));
    expect(card?.title).toContain('新增失败');
    expect(card?.conclusion).toContain('无法比较');
    expect(card?.evidence.some(item => item.label.startsWith('阶段退化'))).toBe(false);
    expect(JSON.stringify(card)).not.toMatch(/NaN|平均耗时从 0ms/);
  });

  it('includes valid zero durations without inventing an undefined percentage', () => {
    const baseline = parse([harEntry('/a', { time: 0 })]);
    const current = parse([harEntry('/a', { time: 5000 })]);
    const card = compareBaselines(baseline, current)[0];
    expect(card?.title).toContain('5000ms');
    expect(card?.title).not.toContain('%');
    expect(card?.evidence).toContainEqual(expect.objectContaining({ label: '正常样本平均耗时', value: '0ms' }));
  });

  it('detects status, protocol and cache changes on common method host path without leaking query values', () => {
    const baseline = parse([
      harEntry('/api/order', { status: 200, protocol: 'HTTP/2', fromCache: 'disk' }),
      harEntry('/api/profile', { status: 200, protocol: 'HTTP/2' }),
    ]);
    const current = parse([
      harEntry('/api/order', { status: 500, protocol: 'HTTP/3', fromCache: 'memory' }),
      harEntry('/api/profile', { status: 200, protocol: 'HTTP/2' }),
    ]);

    const cards = compareBaselines(baseline, current);

    expect(cards.map(card => card.id)).toEqual(expect.arrayContaining([
      'baseline-status-class-changes',
      'baseline-protocol-changes',
      'baseline-cache-source-changes',
    ]));
    expect(JSON.stringify(cards)).not.toContain('SECRET_QUERY');
    expect(cards.find(card => card.id === 'baseline-status-class-changes')?.limitations?.join('\n')).toContain('差异本身不是根因');
  });

  it('does not fabricate comparison when there are no common hosts', () => {
    const baseline = parse([harEntry('/a', { status: 200 })]);
    const current = parse([{
      ...harEntry('/a', { status: 500 }),
      request: { method: 'GET', url: 'https://other.example.test/a', headers: [], cookies: [], queryString: [] },
    }]);

    const cards = compareBaselines(baseline, current);

    expect(cards[0]).toMatchObject({ id: 'baseline-no-overlap', confidence: 'low' });
  });
});
