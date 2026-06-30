import { parseBaselineHarFile } from './baselineHarUpload';

function createFile(content: string) {
  return new File([content], 'sample.har', { type: 'application/json' });
}

describe('parseBaselineHarFile', () => {
  it('解析 HAR 文件并返回请求统计', async () => {
    const file = createFile(JSON.stringify({
      log: {
        creator: { name: 'Chrome', version: '1' },
        entries: [
          {
            startedDateTime: '2026-06-25T00:00:00.000Z',
            time: 123,
            request: {
              method: 'GET',
              url: 'https://example.com/api',
              headers: [],
              queryString: [],
            },
            response: {
              status: 200,
              statusText: 'OK',
              httpVersion: 'h2',
              headers: [],
              content: { mimeType: 'application/json', size: 10 },
              bodySize: 10,
            },
            timings: { blocked: 0, dns: 10, connect: 20, ssl: 30, send: 1, wait: 50, receive: 12 },
          },
        ],
      },
    }));

    const result = await parseBaselineHarFile(file);

    expect(result.totalRequests).toBe(1);
    expect(result.entries[0].domain).toBe('example.com');
  });

  it('解析失败时向调用方抛出错误', async () => {
    await expect(parseBaselineHarFile(createFile('{bad json'))).rejects.toThrow();
  });
});
