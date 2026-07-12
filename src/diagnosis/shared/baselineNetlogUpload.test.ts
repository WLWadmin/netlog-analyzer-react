import { parseBaselineNetlogFile } from './baselineNetlogUpload';

function createFile(content: string): File {
  const file = new File([content], 'sample.json', { type: 'application/json' });
  if (typeof file.text !== 'function') {
    Object.defineProperty(file, 'text', { value: async () => content });
  }
  return file;
}

describe('parseBaselineNetlogFile', () => {
  it('parses a NetLog baseline and preserves clock context', async () => {
    const result = await parseBaselineNetlogFile(createFile(JSON.stringify({
      constants: {
        timeTickOffset: 1_741_095_022_562,
        logEventTypes: { URL_REQUEST_START_JOB: 1 },
        logSourceType: { URL_REQUEST: 1 },
      },
      events: [{ time: '1', type: 1, source: { id: 1, type: 1 }, phase: 0, params: { url: 'https://api.example.test/data' } }],
    })));

    expect(result.totalEvents).toBe(1);
    expect(result.netlogClockContext?.confidence).toBe('verified');
  });

  it('rejects invalid JSON', async () => {
    await expect(parseBaselineNetlogFile(createFile('{bad'))).rejects.toThrow('不是有效 JSON');
  });
});
