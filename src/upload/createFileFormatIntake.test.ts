import {
  createExecutableFileFormatRegistry,
  createFileParseInput,
} from './createFileFormatIntake';

describe('createFileParseInput', () => {
  it('keeps the raw file out of main-thread probe values', async () => {
    const file = new File(['{"traceEvents":[]}'], 'sample.json');
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
    expect(input.payload).toBe(file);
    expect(input.probeVerdicts).toEqual([
      expect.objectContaining({ parserId: 'chromium-performance-trace@1' }),
    ]);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      mode: 'determinate',
      unit: 'bytes',
    }));
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
