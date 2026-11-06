import { formatHarTime, getHarRecordedTransferSize, parseHar } from './harParser';
import { getHarRequestIssue } from './diagnosis/shared/harRequestIssue';
import { isHarTimelineEntryAvailable } from './diagnosis/shared/harWaterfall';

describe('HAR 1.2 standard evidence model', () => {
  it('distinguishes recorded transfer bytes from legacy body and content fallbacks', () => {
    const result = parseHar({ log: { entries: [
      { request: {}, response: { _transferSize: 0, content: { size: 1024 } } },
      { _transferSize: 100, request: {}, response: { content: { size: 1024 } } },
      { request: {}, response: { bodySize: 512, headersSize: 128, content: { size: 1024 } } },
      { request: {}, response: { bodySize: -1, content: { size: 1024 } } },
      { request: {}, response: { _transferSize: -1, content: { size: 1024 } } },
      { request: {}, response: { _transferSize: Infinity, content: { size: 1024 } } },
    ] } });
    expect(result.entries.map(getHarRecordedTransferSize)).toEqual([
      0, 100, undefined, undefined, undefined, undefined,
    ]);
    // Existing analysis consumers retain their legacy size contract.
    expect(result.entries.map(entry => entry.size)).toEqual([0, 100, 512, 1024, 1024, 1024]);
  });

  it('sums only known transfer sizes, including top-level Chromium transfer size', () => {
    const result = parseHar({ log: { entries: [
      { _transferSize: 100, request: { url: 'https://example.test/a' }, response: { status: 200, bodySize: -1, content: {} } },
      { request: { url: 'https://example.test/b' }, response: { status: 200, bodySize: -1, content: {} } },
    ] } });
    expect(result.entries.map(entry => entry.size)).toEqual([100, -1]);
    expect(result.totalSize).toBe(100);
  });
  it('keeps valid requests and page markers when noncritical pages contain invalid elements', () => {
    const result = parseHar({ log: {
      pages: [
        null, 42, 'invalid', [],
        { id: 'valid-page', startedDateTime: '2026-08-20T00:00:00.000Z', pageTimings: { onContentLoad: 10, onLoad: 20 } },
        { id: 'invalid-timing', pageTimings: { onLoad: '9000' } },
      ],
      entries: [{
        startedDateTime: '2026-08-20T00:00:00.000Z', time: 1,
        request: { method: 'GET', url: 'https://example.test/' },
        response: { status: 200 },
        timings: { send: 0, wait: 1, receive: 0 },
      }],
    } });
    expect(result.totalRequests).toBe(1);
    expect(result.pageMarkers).toEqual([expect.objectContaining({
      pageId: 'valid-page', domContentLoadedMs: 10, loadMs: 20,
    })]);
    expect(result.standard.pages.map(page => page.jsonPath)).toEqual([
      '$.log.pages[4]', '$.log.pages[5]',
    ]);
    expect(result.qualityReport?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'structure', severity: 'warning', count: 4,
        samples: [0, 1, 2, 3].map(index => ({ jsonPath: `$.log.pages[${index}]` })),
      }),
    ]));
    expect(parseHar({ log: { pages: [null], entries: [] } }).pageMarkers).toEqual([]);
  });

  it.each([JSON.parse('1e309'), '9000', null, undefined, -1, -2])(
    'excludes unavailable duration %s from slow count and capture span',
    time => {
      const entry = {
        startedDateTime: '2026-08-20T00:00:00.000Z',
        time,
        request: { method: 'GET', url: 'https://example.test/' },
        response: { status: 200 },
        timings: { send: 0, wait: 0, receive: 0 },
      };
      const result = parseHar({ log: { entries: [
        entry,
        { ...entry, startedDateTime: '2026-08-20T00:00:10.000Z', time: 25 },
      ] } });
      expect(result.slowCount).toBe(0);
      expect(result.entries[0].isSlow).toBe(false);
      expect(Number.isNaN(result.entries[0].time)).toBe(true);
      expect(formatHarTime(result.entries[0].time)).toBe('-');
      expect(result.totalTime).toBe(25);
      expect(isHarTimelineEntryAvailable(result.entries[0])).toBe(false);
      expect(result.qualityReport?.issues.some(issue =>
        issue.samples.some(sample => sample.jsonPath === '$.log.entries[0].time'),
      )).toBe(true);
      const unavailable = parseHar({ log: { entries: [entry] } });
      expect(Number.isNaN(unavailable.totalTime)).toBe(true);
      expect(formatHarTime(unavailable.totalTime)).toBe('-');
    },
  );

  it('keeps zero duration known and rejects nonfinite or coerced timing phases', () => {
    const result = parseHar({ log: { entries: [{
      startedDateTime: '2026-08-20T00:00:00.000Z', time: 0,
      request: { method: 'GET', url: 'https://example.test/' },
      response: { status: 200 },
      timings: { send: 0, wait: JSON.parse('1e309'), receive: '9000' },
    }] } });
    expect(result.entries[0].time).toBe(0);
    expect(result.totalTime).toBe(0);
    expect(result.entries[0].timingAvailability?.wait).toBe(false);
    expect(result.entries[0].timingAvailability?.receive).toBe(false);
    expect(result.entries[0].timings.wait).toBe(0);
    expect(result.entries[0].timings.receive).toBe(0);
    expect(result.entries[0].standard.timings.wait.state).toBe('invalid');
    expect(result.entries[0].standard.timings.receive.state).toBe('invalid');
  });

  it('keeps omitted duration unknown without inventing a zero measurement', () => {
    const result = parseHar({ log: { entries: [{
      startedDateTime: '2026-08-20T00:00:00.000Z',
      request: { method: 'GET', url: 'https://example.test/' },
      response: { status: 200 },
    }] } });
    expect(result.entries[0].standard.time.state).toBe('missing');
    expect(formatHarTime(result.entries[0].time)).toBe('-');
    expect(formatHarTime(result.totalTime)).toBe('-');
    expect(result.slowCount).toBe(0);
  });

  it.each([200, 0])('consumes failure extensions at both levels with status %s', status => {
    for (const level of ['entry', 'response']) {
      for (const field of ['_error', 'error', 'errorText', '_netError', 'netError']) {
        const failure = { [field]: 'net::ERR_CONNECTION_RESET' };
        const result = parseHar({ log: { entries: [{
          ...(level === 'entry' ? failure : {}),
          startedDateTime: '2026-08-20T00:00:00.000Z', time: 1,
          request: { method: 'GET', url: 'https://example.test/' },
          response: { status, ...(level === 'response' ? failure : {}) },
          timings: { send: 0, wait: 1, receive: 0 },
        }] } });
        const entry = result.entries[0];
        expect(result.failedCount).toBe(1);
        expect(entry.netErrorText).toBe('net::ERR_CONNECTION_RESET');
        expect(getHarRequestIssue(entry).kind).toBe('net-error');
        const extensionKey = field === 'errorText' ? 'errorText'
          : field === '_netError' || field === 'netError' ? 'netError' : 'error';
        expect(entry.extensions?.[extensionKey]).toBe(field === 'error' ? undefined : 'net::ERR_CONNECTION_RESET');
      }
    }
  });

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
