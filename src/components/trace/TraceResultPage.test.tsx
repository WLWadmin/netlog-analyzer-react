import { render, screen } from '@testing-library/react';
import type { TraceContextResult } from '../../parsers/trace/types';
import TraceResultPage from './TraceResultPage';

const result: TraceContextResult = {
  intake: {
    format: 'chromium-trace-object',
    encoding: 'gzip-json',
    jsonBytes: 1024,
    eventCount: 12,
    captureStartUs: 0,
    captureEndUs: 2_000_000,
    availableFamilies: ['metadata', 'main-thread'],
    warnings: [],
  },
  context: {
    processes: [],
    threads: [],
    frames: [],
    navigations: [],
    evidence: [],
    evidenceTotalCount: 3,
    evidenceReturnedCount: 3,
    quality: {
      level: 'partial',
      captureWindow: 'available',
      navigationContext: 'missing',
      processThreadMetadata: 'partial',
      frameHierarchy: 'missing',
      rendererMainThread: 'missing',
      skippedEventCount: 0,
      warnings: ['缺少导航事件'],
      disabledCapabilities: ['页面加载诊断暂不可用'],
    },
    warnings: [],
  },
};

describe('TraceResultPage', () => {
  it('shows bounded Trace facts and an explicit diagnosis boundary', () => {
    render(<TraceResultPage result={result} />);

    expect(screen.getByRole('heading', { name: 'Trace 上下文接入结果' })).not.toBeNull();
    expect(screen.getByText('12')).not.toBeNull();
    expect(screen.getByText('2.00 秒')).not.toBeNull();
    expect(screen.getByText('页面加载诊断暂不可用')).not.toBeNull();
    expect(screen.getByText(/不输出未经证据模型验证的性能结论/)).not.toBeNull();
    expect(screen.queryByText(/根因/)).toBeNull();
  });
});
