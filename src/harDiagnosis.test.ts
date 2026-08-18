import { diagnoseHar } from './harDiagnosis';
import { parseHar } from './harParser';

function harEntry(path: string, connect: number, ssl: number) {
  return {
    startedDateTime: '2026-08-18T00:00:00.000Z',
    time: connect + 10,
    request: { method: 'GET', url: `https://example.test/${path}`, headers: [] },
    response: {
      status: 200,
      statusText: 'OK',
      headers: [],
      content: { size: 0, mimeType: 'text/plain' },
    },
    timings: { blocked: 0, dns: 0, connect, ssl, send: 1, wait: 8, receive: 1 },
  };
}

describe('diagnoseHar timing phases', () => {
  it('uses order-independent percentiles and excludes TLS from TCP duration', () => {
    const parsed = parseHar({
      log: {
        version: '1.2',
        creator: { name: 'test', version: '1' },
        entries: [
          harEntry('slow', 900, 800),
          harEntry('fast', 20, 10),
          harEntry('middle', 200, 50),
        ],
      },
    });

    const result = diagnoseHar(parsed);
    const tcp = result.networkStatus.find(phase => phase.label === 'TCP');
    const tls = result.networkStatus.find(phase => phase.label === 'TLS');

    expect(tcp).toMatchObject({ avgMs: 87, maxMs: 150, p95Ms: 150, slowCount: 0 });
    expect(tls).toMatchObject({ maxMs: 800, p95Ms: 800, slowCount: 1 });
  });
});
