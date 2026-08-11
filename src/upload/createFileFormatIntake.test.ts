import {
  createExecutableFileFormatRegistry,
  createFileParseInput,
} from './createFileFormatIntake';

describe('createFileParseInput', () => {
  it('reuses one in-memory snapshot for small-file probing and parsing', async () => {
    const file = new File(['{"traceEvents":[]}'], 'sample.json');
    const readSnapshot = jest.fn().mockResolvedValue(
      new Uint8Array(file.size).buffer,
    );
    Object.defineProperty(file, 'arrayBuffer', { value: readSnapshot });
    const onProgress = jest.fn();
    const probeFile = jest.fn().mockImplementation(async (
      _file,
      options,
    ) => {
      options.onProgress({
        phase: 'probing-format',
        processedBytes: file.size,
        totalBytes: file.size,
      });
      return {
        container: 'plain',
        verdicts: [{
          kind: 'definite-match',
          parserId: 'chromium-performance-trace@1',
          evidenceCodes: ['TRACE_EVENTS_ARRAY'],
        }],
      };
    });

    const input = await createFileParseInput(file, 'task-1', {
      probeFile,
      onProgress,
    });

    expect(input.value).toBeUndefined();
    expect(input.payload).toBeInstanceOf(File);
    expect(input.payload).not.toBe(file);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(probeFile).toHaveBeenCalledWith(input.payload, expect.any(Object));
    expect(input.probeVerdicts).toEqual([
      expect.objectContaining({ parserId: 'chromium-performance-trace@1' }),
    ]);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      phase: 'reading',
      label: '正在读取文件快照',
      mode: 'indeterminate',
    }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      mode: 'determinate',
      unit: 'bytes',
    }));
  });

  it('keeps the original File path for files above the snapshot threshold', async () => {
    const file = new File(['{}'], 'large.json');
    Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 + 1 });
    const probeFile = jest.fn().mockResolvedValue({
      container: 'plain',
      verdicts: [],
    });

    const input = await createFileParseInput(file, 'task-large', { probeFile });

    expect(probeFile).toHaveBeenCalledWith(file, expect.any(Object));
    expect(input.payload).toBe(file);
  });
});

describe('createExecutableFileFormatRegistry', () => {
  it('灰度关闭时不注册 Trace 解析器', () => {
    const registry = createExecutableFileFormatRegistry({
      useWorker: false,
      traceEnabled: false,
    });

    expect(registry.list().map(adapter => adapter.parserId)).not.toContain(
      'chromium-performance-trace@1',
    );
  });

  it('灰度开启时注册 Trace 解析器并保留其他格式', () => {
    const registry = createExecutableFileFormatRegistry({
      useWorker: false,
      traceEnabled: true,
    });

    expect(registry.list().map(adapter => adapter.parserId)).toEqual([
      'har@1',
      'chromium-netlog@1',
      'chromium-performance-trace@1',
      'go-service-log@1',
    ]);
  });
});
