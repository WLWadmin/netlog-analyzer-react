import { getHarResponseStatus, parseHar } from './harParser';

it.each([-2, -1, 1, 99, 200.5, 599.5, 600, 999, '200', null, undefined, Infinity])(
  'keeps invalid HTTP status %s unknown without inventing a failure',
  status => {
    const result = parseHar({ log: { entries: [{
      time: 0, request: { method: 'GET', url: 'https://example.test/' },
      response: { status, statusText: 'net::ERR_CONNECTION_RESET' },
    }] } });
    const entry = result.entries[0];
    expect(getHarResponseStatus(entry)).toBeUndefined();
    expect(Number.isNaN(entry.status)).toBe(true);
    expect(entry.isFailed).toBe(false);
    expect(entry.netErrorText).toBeUndefined();
    expect(result.qualityReport?.issues.some(issue =>
      issue.samples.some(sample => sample.jsonPath === '$.log.entries[0].response.status'),
    )).toBe(true);
  },
);

it.each([0, 100, 200, 399, 400, 599])('preserves recorded zero and valid HTTP status %s', status => {
  const result = parseHar({ log: { entries: [{
    time: 0, request: { method: 'GET', url: 'https://example.test/' }, response: { status },
  }] } });
  expect(getHarResponseStatus(result.entries[0])).toBe(status);
  expect(result.entries[0].isFailed).toBe(status === 0 || status >= 400);
});
