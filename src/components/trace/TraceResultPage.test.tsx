import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { TraceAnalysisResult } from '../../diagnosis/trace';
import { NavigationProvider, useNavigation } from '../../contexts/NavigationContext';
import { buildTraceJsonExport, buildTraceMarkdownReport } from '../../parsers/trace/exportTraceReport';
import { downloadTextFile } from '../../utils/downloadTextFile';
import type { TraceTab } from '../../utils/hashRouting';
import TraceResultPage from './TraceResultPage';

jest.mock('../../parsers/trace/exportTraceReport', () => ({
  buildTraceMarkdownReport: jest.fn(),
  buildTraceJsonExport: jest.fn(),
}));

jest.mock('../../utils/downloadTextFile', () => ({
  downloadTextFile: jest.fn(),
}));

const mockBuildTraceMarkdownReport = buildTraceMarkdownReport as jest.Mock;
const mockBuildTraceJsonExport = buildTraceJsonExport as jest.Mock;
const mockDownloadTextFile = downloadTextFile as jest.Mock;

const result: TraceAnalysisResult = {
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
    evidence: [{ evidenceId: 'trace:event:7', eventIndex: 7, origin: 'raw', name: 'ResourceReceiveResponse', processId: 1, threadId: 2, timestampUs: 3000 }],
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
    requests: [{ id: 'request-1', requestId: '1', redirectIndex: 0, result: 'http-error', resultConfidence: 'high', timing: { trace: { startUs: 1 } }, initiatorEvidenceIds: [], evidenceIds: ['trace:event:7'], limitations: [], dataEventCount: 0 }],
  },
  diagnosis: {
    diagnoses: [
      {
        id: 'network-diagnosis',
        ruleId: 'N1',
        category: 'network',
        severity: 'warning',
        score: 80,
        title: 'HTTP 404',
        conclusion: 'Trace 中记录到 HTTP 404 响应。',
        confidence: 'observation',
        evidenceIds: ['trace:event:7'],
        counterEvidence: ['存在 HTTP 响应。'],
        advice: ['检查请求地址。'],
        navigationKey: 'nav-1',
        factIds: ['request-1'],
        limitations: [],
      },
      {
        id: 'interaction-diagnosis',
        ruleId: 'I1',
        category: 'interaction',
        severity: 'warning',
        score: 70,
        title: '交互延迟候选',
        conclusion: 'Trace 内存在交互延迟候选。',
        confidence: 'observation',
        evidenceIds: ['trace:event:8'],
        counterEvidence: [],
        advice: [],
        factIds: ['interaction-1'],
        limitations: [],
      },
    ],
    evaluations: [],
  },
};

describe('TraceResultPage', () => {
  beforeEach(() => {
    delete process.env.REACT_APP_ENABLE_TRACE_WORKBENCH;
    mockBuildTraceMarkdownReport.mockReset();
    mockBuildTraceJsonExport.mockReset();
    mockDownloadTextFile.mockReset();
  });

  it('only exposes the internal Workbench entry when the compile-time flag is enabled', () => {
    const { rerender } = render(<TraceResultPage result={result} />);
    expect(screen.queryByText('分析工作台（内部）')).toBeNull();

    process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '1';
    rerender(<TraceResultPage result={result} />);
    expect(screen.getByText('分析工作台（内部）')).not.toBeNull();
    expect(screen.getByText(/没有可复用的 Workbench Worker/)).not.toBeNull();
  });

  it('exports Markdown and JSON from the current result', async () => {
    const jsonExport = { schemaVersion: 1, quality: { level: 'partial' } };
    mockBuildTraceMarkdownReport.mockReturnValue('# Trace report');
    mockBuildTraceJsonExport.mockReturnValue(jsonExport);
    render(<TraceResultPage result={result} />);

    await userEvent.click(screen.getByRole('button', { name: '导出 Markdown' }));
    expect(mockBuildTraceMarkdownReport).toHaveBeenCalledWith(result);
    expect(mockDownloadTextFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.md$/),
      '# Trace report',
      'text/markdown;charset=utf-8',
    );

    await userEvent.click(screen.getByRole('button', { name: '导出 JSON' }));
    expect(mockBuildTraceJsonExport).toHaveBeenCalledWith(result);
    expect(mockDownloadTextFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.json$/),
      JSON.stringify(jsonExport, null, 2),
      'application/json;charset=utf-8',
    );
  });

  it('shows an accessible error without downloading when export fails', async () => {
    mockBuildTraceMarkdownReport.mockImplementation(() => {
      throw new Error('sensitive export detail');
    });
    render(<TraceResultPage result={result} />);

    await userEvent.click(screen.getByRole('button', { name: '导出 Markdown' }));

    expect(screen.getAllByRole('alert').some(alert => alert.textContent === 'Markdown 导出失败，请重试。')).toBe(true);
    expect(screen.queryByText(/sensitive export detail/)).toBeNull();
    expect(mockDownloadTextFile).not.toHaveBeenCalled();
  });
  it('shows bounded Trace facts and an explicit diagnosis boundary', () => {
    render(<TraceResultPage result={result} activeTab="overview" />);

    expect(screen.getByRole('heading', { name: '性能诊断' })).not.toBeNull();
    expect(screen.getByText('12')).not.toBeNull();
    expect(screen.getByText('2.00 秒')).not.toBeNull();
    expect(screen.getByText('页面加载诊断暂不可用')).not.toBeNull();
    expect(screen.getByText(/当前结论只基于本次录制窗口内的有限事实/)).not.toBeNull();
    expect(screen.getByText('Trace 分析边界')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: /根因/ })).toBeNull();
  });

  it('按七路由展示结论、分类诊断和证据定位', () => {
    const { rerender } = render(<TraceResultPage result={result} activeTab="conclusion" />);
    expect(screen.getByRole('heading', { name: '优先结论' })).not.toBeNull();
    expect(screen.getByText('HTTP 404')).not.toBeNull();
    expect(screen.getByText('交互延迟候选')).not.toBeNull();

    rerender(<TraceResultPage result={result} activeTab="network" />);
    expect(screen.getByText('HTTP 错误 · request-1')).not.toBeNull();
    expect(screen.queryByText('交互延迟候选')).toBeNull();

    rerender(<TraceResultPage result={result} activeTab="interactions" />);
    expect(screen.getByText('未取得已配对交互')).not.toBeNull();
    expect(screen.queryByText('HTTP 404')).toBeNull();

    rerender(<TraceResultPage result={result} activeTab="evidence" />);
    expect(screen.getByRole('heading', { name: '证据索引' })).not.toBeNull();
    expect(screen.getByText('ResourceReceiveResponse')).not.toBeNull();
    expect(screen.getByText('eventIndex 7')).not.toBeNull();
    expect(screen.queryByText('原始证据详情')).toBeNull();
  });

  it.each([
    ['conclusion', 'trace-conclusion-tab'],
    ['overview', 'trace-overview-tab'],
    ['network', 'trace-network-tab'],
    ['main-thread', 'trace-main-thread-tab'],
    ['rendering', 'trace-rendering-tab'],
    ['interactions', 'trace-interactions-tab'],
    ['evidence', 'trace-evidence-tab'],
  ] as const)('%s 使用独立 Tab 组件', (tab, testId) => {
    render(<TraceResultPage result={result} activeTab={tab} />);
    expect(screen.getByTestId(testId)).not.toBeNull();
  });

  it('结论卡展示一条结论、证据和建议，并分别跳事实与原始证据', async () => {
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const Harness = () => {
      const [tab, setTab] = useState<TraceTab>('conclusion');
      return <TraceResultPage result={result} activeTab={tab} onTabChange={setTab} />;
    };

    render(<NavigationProvider><Harness /></NavigationProvider>);
    expect(screen.getByText('观察：Trace 中记录到 HTTP 404 响应。')).not.toBeNull();
    expect(screen.getByText('检查请求地址。')).not.toBeNull();
    expect(screen.getAllByText('警告').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: '查看事实：HTTP 404' }));
    expect(await screen.findByText(/HTTP 错误/, {
      selector: '#trace-fact-request-1.is-highlighted strong',
    })).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '结论' }));
    await userEvent.click(screen.getByRole('button', { name: '查看证据索引：HTTP 404' }));
    expect(await screen.findByText('ResourceReceiveResponse', {
      selector: '[id="trace-evidence-trace%3Aevent%3A7"] h2',
    })).not.toBeNull();
    expect(screen.getByText('eventIndex 7')).not.toBeNull();
  });

  it('目标缺失时提示失败、消费意图，并允许重复点击同一目标', async () => {
    jest.useFakeTimers();
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const IntentProbe = () => {
      const { intent } = useNavigation();
      return <span data-testid="trace-intent-state">{intent ? 'pending' : 'consumed'}</span>;
    };
    const missingResult: TraceAnalysisResult = {
      ...result,
      diagnosis: { diagnoses: [{ ...result.diagnosis.diagnoses[0], factIds: ['missing-fact'] }], evaluations: [] },
    };
    const Harness = () => {
      const [tab, setTab] = useState<TraceTab>('conclusion');
      return <><TraceResultPage result={missingResult} activeTab={tab} onTabChange={setTab} /><IntentProbe /></>;
    };

    render(<NavigationProvider><Harness /></NavigationProvider>);
    await userEvent.click(screen.getByRole('button', { name: '查看事实：HTTP 404' }));
    expect(await screen.findByText('未找到目标事实：missing-fact')).not.toBeNull();
    expect(screen.getByTestId('trace-intent-state').textContent).toBe('consumed');

    await userEvent.click(screen.getByRole('button', { name: '结论' }));
    await userEvent.click(screen.getByRole('button', { name: '查看证据索引：HTTP 404' }));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: '结论' }));
    await userEvent.click(screen.getByRole('button', { name: '查看证据索引：HTTP 404' }));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));

    const highlightedEvidenceSelector = '[id="trace-evidence-trace%3Aevent%3A7"].is-highlighted h2';
    expect(screen.getByText('ResourceReceiveResponse', { selector: highlightedEvidenceSelector })).not.toBeNull();
    act(() => { jest.advanceTimersByTime(2000); });
    expect(screen.queryByText('ResourceReceiveResponse', { selector: highlightedEvidenceSelector })).toBeNull();
    jest.useRealTimers();
  });

  it('证据超过首批展示上限时仍能从结论直接定位目标', async () => {
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const evidence = Array.from({ length: 150 }, (_, index) => ({
      evidenceId: `trace:event:${index}`,
      eventIndex: index,
      origin: 'raw' as const,
      name: `Event ${index}`,
    }));
    const largeResult: TraceAnalysisResult = {
      ...result,
      context: {
        ...result.context,
        evidence,
        evidenceReturnedCount: evidence.length,
        evidenceTotalCount: evidence.length,
      },
      diagnosis: {
        diagnoses: [{
          ...result.diagnosis.diagnoses[0],
          evidenceIds: ['trace:event:149'],
        }],
        evaluations: [],
      },
    };
    const Harness = () => {
      const [tab, setTab] = useState<TraceTab>('conclusion');
      return <TraceResultPage result={largeResult} activeTab={tab} onTabChange={setTab} />;
    };

    render(<NavigationProvider><Harness /></NavigationProvider>);
    await userEvent.click(screen.getByRole('button', { name: '查看证据索引：HTTP 404' }));

    expect(await screen.findByText('Event 149', {
      selector: '[id="trace-evidence-trace%3Aevent%3A149"] h2',
    })).not.toBeNull();
    expect(screen.queryByText('Event 100')).toBeNull();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });


  it('七页展示定位所需完整字段，overview 提供 quality 锚点', () => {
    const { rerender } = render(<TraceResultPage result={result} activeTab="overview" />);
    expect(screen.getByText('采集质量', { selector: '#trace-fact-quality h2' })).not.toBeNull();
    expect(screen.getByText('导航上下文')).not.toBeNull();
    expect(screen.getByText('JSON 大小')).not.toBeNull();

    rerender(<TraceResultPage result={result} activeTab="network" />);
    expect(screen.getByText('请求 ID')).not.toBeNull();
    expect(screen.getByText('Trace 开始')).not.toBeNull();

    rerender(<TraceResultPage result={result} activeTab="evidence" />);
    expect(screen.getByText('进程')).not.toBeNull();
    expect(screen.getByText('线程')).not.toBeNull();
    expect(screen.getByText('时间')).not.toBeNull();
  });


  it('各事实页展示最终诊断所需字段', () => {
    const detailed: TraceAnalysisResult = {
      ...result,
      context: {
        ...result.context,
        requests: [{ ...result.context.requests?.[0] ?? { id: 'request-1', requestId: '1', redirectIndex: 0, result: 'http-error', resultConfidence: 'high', timing: { trace: { startUs: 1 } }, initiatorEvidenceIds: [], evidenceIds: [], limitations: [], dataEventCount: 0 }, fromCache: true, dispatch: { dispatchWaitMs: 30, mainThreadOverlapMs: 20 }, limitations: ['dispatch 限制'] }],
        profiles: [{ id: 'profile-1', processId: 1, threadId: 2, profileId: 'p1', startUs: 1, endUs: 100, nodeCount: 2, sampleCount: 3, evidenceIds: [], limitations: ['profile 限制'] }],
        cpuHotspots: [{ id: 'hotspot-1', processId: 1, threadId: 2, profileId: 'p1', nodeId: 3, functionName: 'work', script: { origin: 'https://example.com', pathname: '/app.js' }, lineNumber: 10, columnNumber: 20, sampleCount: 4, sampleTimeMs: 12, taskIds: [], evidenceIds: [] }],
        milestones: [{ id: 'milestone-1', navigationKey: 'nav-1', name: 'LCP', timestampUs: 10, relativeUs: 9, candidate: true, evidenceIds: [] }],
        forcedReflowClues: [{ id: 'clue-1', startUs: 1, confidence: 'observation', evidenceIds: [] }],
        animationFrameSummary: { completeness: 'partial', limitations: ['帧限制'], totalCount: 2, droppedCount: 1, overBudgetCount: 1, maxDurationMs: 20, budgetMs: 16.7, budgetBasis: '60hz-reference', refreshRate: 'unknown' },
        interactions: [{ id: 'interaction-1', interactionId: 1, startUs: 1, inputDelayMs: 2, processingDurationMs: 3, presentationDelayMs: 4, totalLatencyMs: 9, taskIds: [], renderingEventIds: [], frameIds: [], evidenceIds: [] }],
        interactionSummary: { completeness: 'partial', limitations: ['交互限制'], totalCount: 1, slowestInteractionId: 'interaction-1', maxTotalLatencyMs: 9 },
      },
    };
    const { rerender } = render(<TraceResultPage result={detailed} activeTab="overview" />);
    expect(screen.queryByText('HTTP 错误 · request-1')).toBeNull();
    expect(screen.getByText(/LCP 候选/, { selector: '#trace-fact-milestone-1' })).not.toBeNull();

    rerender(<TraceResultPage result={detailed} activeTab="network" />);
    expect(screen.getByText(/HTTP 错误/, { selector: '#trace-fact-request-1 strong' })).not.toBeNull();
    expect(screen.getByText('缓存')).not.toBeNull();
    expect(screen.getByText('派发等待 / 主线程重叠')).not.toBeNull();
    expect(screen.getByText('dispatch 限制')).not.toBeNull();

    rerender(<TraceResultPage result={detailed} activeTab="main-thread" />);
    expect(screen.getByText('Profile · profile-1')).not.toBeNull();
    expect(screen.getByText('行 / 列')).not.toBeNull();
    expect(screen.getByText('profile 限制')).not.toBeNull();

    rerender(<TraceResultPage result={detailed} activeTab="rendering" />);
    expect(screen.queryByText(/LCP 候选/)).toBeNull();
    expect(screen.getByText(/60 Hz 参考预算/)).not.toBeNull();
    expect(screen.getByText(/弱线索/)).not.toBeNull();

    rerender(<TraceResultPage result={detailed} activeTab="interactions" />);
    expect(screen.getByText('汇总完整性')).not.toBeNull();
    expect(screen.getByText(/INP 候选/)).not.toBeNull();
    expect(screen.getByText('交互限制')).not.toBeNull();
  });

});
