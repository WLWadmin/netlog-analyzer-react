import { parseHar } from './harParser';

describe('HAR 1.2 standard evidence model', () => {
  it('retains log, page, entry, request, response, cache and timing fields with JSON paths', () => {
    const result = parseHar({
      log: {
        version: '1.2',
        creator: { name: 'Chrome', version: '140', comment: 'creator note' },
        browser: { name: 'Chrome', version: '140', comment: 'browser note' },
        comment: 'log note',
        pages: [{
          id: 'page-1', title: 'Example', startedDateTime: '2026-08-20T00:00:00.000Z',
          pageTimings: { onContentLoad: 100, onLoad: -1, comment: 'page timing note' },
          comment: 'page note',
        }],
        entries: [{
          pageref: 'page-1', startedDateTime: '2026-08-20T00:00:00.100Z', time: 25,
          serverIPAddress: '203.0.113.10', connection: '42', comment: 'entry note',
          request: {
            method: 'POST', url: 'https://example.test/upload', httpVersion: 'HTTP/2',
            headers: [{ name: 'accept', value: '*/*', comment: 'header note' }],
            queryString: [{ name: 'mode', value: 'test', comment: 'query note' }],
            cookies: [{ name: 'session', value: 'TEST', comment: 'cookie note' }],
            headersSize: 0, bodySize: -1, comment: 'request note',
            postData: {
              mimeType: 'multipart/form-data', text: 'body', comment: 'post note',
              params: [{ name: 'file', value: '', fileName: 'a.txt', contentType: 'text/plain', comment: 'param note' }],
            },
          },
          response: {
            status: 201, statusText: 'Created', httpVersion: 'HTTP/2',
            headers: [{ name: 'content-type', value: 'text/plain', comment: 'response header note' }],
            cookies: [], redirectURL: '', headersSize: -1, bodySize: 4, comment: 'response note',
            content: { size: 4, compression: 0, mimeType: 'text/plain', text: 'done', encoding: 'utf8', comment: 'content note' },
          },
          cache: {
            beforeRequest: { expires: '2026-08-21T00:00:00.000Z', lastAccess: '2026-08-20T00:00:00.000Z', eTag: 'before', hitCount: 0, comment: 'before note' },
            afterRequest: { eTag: 'after', hitCount: 1, comment: 'after note' },
            comment: 'cache note',
          },
          timings: { send: 0, wait: 20, receive: 5, blocked: -1, dns: -1, connect: -1, ssl: -1, comment: 'timing note' },
        }],
      },
    });

    expect(result.standard).toEqual(expect.objectContaining({
      version: '1.2',
      creator: { name: 'Chrome', version: '140', comment: 'creator note' },
      browser: { name: 'Chrome', version: '140', comment: 'browser note' },
      comment: 'log note',
    }));
    expect(result.standard.pages[0]).toEqual(expect.objectContaining({
      id: 'page-1',
      comment: 'page note',
      jsonPath: '$.log.pages[0]',
      pageTimings: expect.objectContaining({
        onContentLoad: { state: 'value', value: 100 },
        onLoad: { state: 'not-available', value: -1 },
        comment: 'page timing note',
      }),
    }));

    const standard = result.entries[0].standard;
    expect(standard.jsonPath).toBe('$.log.entries[0]');
    expect(standard.comment).toBe('entry note');
    expect(standard.request).toEqual(expect.objectContaining({
      httpVersion: 'HTTP/2',
      headersSize: { state: 'value', value: 0 },
      bodySize: { state: 'not-available', value: -1 },
      comment: 'request note',
      postData: expect.objectContaining({
        comment: 'post note',
        params: [{ name: 'file', value: '', fileName: 'a.txt', contentType: 'text/plain', comment: 'param note' }],
      }),
    }));
    expect(standard.response.content).toEqual(expect.objectContaining({
      size: { state: 'value', value: 4 },
      compression: { state: 'value', value: 0 },
      text: { state: 'inline', originalLength: 4, valueSource: 'responseBody' },
      comment: 'content note',
    }));
    expect(standard.response.content.text).not.toHaveProperty('value');
    expect(result.entries[0].responseBody).toBe('done');
    expect(standard.cache).toEqual(expect.objectContaining({
      beforeRequest: expect.objectContaining({ hitCount: { state: 'value', value: 0 } }),
      afterRequest: expect.objectContaining({ hitCount: { state: 'value', value: 1 } }),
      comment: 'cache note',
    }));
    expect(standard.timings).toEqual(expect.objectContaining({
      send: { state: 'value', value: 0 },
      blocked: { state: 'not-available', value: -1 },
      comment: 'timing note',
    }));
  });

  it('distinguishes missing, not-available, zero and invalid numeric fields', () => {
    const entry = parseHar({ log: { entries: [{
      startedDateTime: 'invalid-date',
      time: 'invalid',
      request: { method: 'GET', url: 'https://example.test/', headers: [], queryString: [], headersSize: 0 },
      response: { status: 0, statusText: '', headers: [], bodySize: -1, content: { size: 'invalid', compression: null } },
      cache: { beforeRequest: { hitCount: 'invalid' } },
      timings: { send: 0, wait: -1, receive: 'invalid' },
    }] } }).entries[0];

    expect(entry.standard.time).toEqual({ state: 'invalid' });
    expect(entry.standard.request.headersSize).toEqual({ state: 'value', value: 0 });
    expect(entry.standard.request.bodySize).toEqual({ state: 'missing' });
    expect(entry.standard.response.headersSize).toEqual({ state: 'missing' });
    expect(entry.standard.response.bodySize).toEqual({ state: 'not-available', value: -1 });
    expect(entry.standard.response.content.size).toEqual({ state: 'invalid' });
    expect(entry.standard.response.content.compression).toEqual({ state: 'invalid' });
    expect(entry.standard.cache?.beforeRequest?.hitCount).toEqual({ state: 'invalid' });
    expect(entry.standard.timings.send).toEqual({ state: 'value', value: 0 });
    expect(entry.standard.timings.wait).toEqual({ state: 'not-available', value: -1 });
    expect(entry.standard.timings.receive).toEqual({ state: 'invalid' });
    expect(entry.standard.timings.dns).toEqual({ state: 'missing' });
  });

  it('separates Chromium extensions and keeps deferred bodies out of the standard model', () => {
    const largeBody = 'x'.repeat(9 * 1024 * 1024);
    const entry = parseHar({ log: { entries: [{
      _error: 'net::ERR_FAILED', _netError: -2, errorText: 'failed', blockedReason: 'inspector',
      _initiator: { type: 'script' }, _priority: 'High', _resourceType: 'xhr', _transferSize: 123,
      startedDateTime: '2026-08-20T00:00:00.000Z', time: 1,
      request: { method: 'GET', url: 'https://example.test/', headers: [], queryString: [] },
      response: { status: 0, statusText: '', headers: [], content: { size: largeBody.length, mimeType: 'application/octet-stream', text: largeBody } },
      timings: { send: 0, wait: 1, receive: 0, _blocked_queueing: 3 },
    }] } }).entries[0];

    expect(entry.extensions).toEqual(expect.objectContaining({
      error: 'net::ERR_FAILED', netError: -2, errorText: 'failed', blockedReason: 'inspector',
      priority: 'High', resourceType: 'xhr', transferSize: 123,
      timing: { blockedQueueingMs: 3 },
    }));
    expect(entry.standard.response.content.text).toEqual({
      state: 'deferred',
      originalLength: largeBody.length,
    });
    expect(entry.standard.response.content.text).not.toHaveProperty('value');
    expect(entry.responseBody).toBe('');
  });
});
