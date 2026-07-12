import { parseHar } from '../../harParser';
import { compareBaselines } from './baselineComparator';

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
