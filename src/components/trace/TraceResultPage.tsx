import { useMemo, useState } from 'react';
import type { TraceAnalysisResult } from '../../diagnosis/trace';
import { buildTraceJsonExport, buildTraceMarkdownReport } from '../../parsers/trace/exportTraceReport';
import { useNavigation } from '../../contexts/NavigationContext';
import type { TraceTab } from '../../utils/hashRouting';
import { downloadTextFile } from '../../utils/downloadTextFile';
import type { TraceWorkbenchClient } from '../../workbench/client';
import { isTraceWorkbenchEnabled } from '../../workbench/featureFlag';
import { AnalysisDisclaimer } from '../shared/AnalysisDisclaimer';
import { buildTraceDiagnosisViewModel, type TraceEvidenceTarget, type TraceFactTarget } from './traceDiagnosisViewModel';
import TraceConclusionTab from './tabs/TraceConclusionTab';
import TraceEvidenceTab from './tabs/TraceEvidenceTab';
import TraceInteractionsTab from './tabs/TraceInteractionsTab';
import TraceMainThreadTab from './tabs/TraceMainThreadTab';
import TraceNetworkTab from './tabs/TraceNetworkTab';
import TraceOverviewTab from './tabs/TraceOverviewTab';
import TraceRenderingTab from './tabs/TraceRenderingTab';
import TraceWorkbenchInternalPanel from './TraceWorkbenchInternalPanel';
import './traceResultPage.css';

interface TraceResultPageProps {
  result: TraceAnalysisResult;
  activeTab?: TraceTab;
  onTabChange?: (tab: TraceTab) => void;
  workbenchClient?: TraceWorkbenchClient;
}

const TABS: Array<{ tab: TraceTab; label: string }> = [
  { tab: 'conclusion', label: '结论' }, { tab: 'overview', label: '概览' },
  { tab: 'network', label: '网络' }, { tab: 'main-thread', label: '主线程' },
  { tab: 'rendering', label: '渲染' }, { tab: 'interactions', label: '交互' },
  { tab: 'evidence', label: '证据' },
];

const TraceResultPage: React.FC<TraceResultPageProps> = ({
  result,
  activeTab = 'conclusion',
  onTabChange,
  workbenchClient,
}) => {
  const { navigateTo } = useNavigation();
  const [exportError, setExportError] = useState('');
  const diagnosisViewModel = useMemo(() => buildTraceDiagnosisViewModel(result), [result]);

  const exportMarkdown = () => {
    setExportError('');
    try {
      downloadTextFile(
        `chromium-trace-analysis-${Date.now()}.md`,
        buildTraceMarkdownReport(result),
        'text/markdown;charset=utf-8',
      );
    } catch {
      setExportError('Markdown 导出失败，请重试。');
    }
  };

  const exportJson = () => {
    setExportError('');
    try {
      downloadTextFile(
        `chromium-trace-analysis-${Date.now()}.json`,
        JSON.stringify(buildTraceJsonExport(result), null, 2),
        'application/json;charset=utf-8',
      );
    } catch {
      setExportError('JSON 导出失败，请重试。');
    }
  };

  const navigateFact = (target: TraceFactTarget) => {
    navigateTo({ fileType: 'trace', tab: target.tab, scrollTo: { type: 'fact', id: target.factId } });
    onTabChange?.(target.tab);
  };

  const navigateEvidence = (target: TraceEvidenceTarget) => {
    navigateTo({ fileType: 'trace', evidenceSource: 'trace', tab: 'evidence', scrollTo: { type: 'evidence', id: target.evidenceId } });
    onTabChange?.('evidence');
  };

  const qualityLabel = result.context.quality.level === 'good'
    ? '良好'
    : result.context.quality.level === 'partial'
      ? '部分可用'
      : '证据不足';

  return (
    <section className="trace-result" aria-labelledby="trace-result-title">
      <header className="trace-result-heading">
        <div>
          <span>CHROMIUM PERFORMANCE TRACE</span>
          <h1 id="trace-result-title">性能诊断</h1>
          <p>从页面加载、网络、主线程、渲染和交互事实中定位优先排查方向。</p>
        </div>
        <div className="trace-result-heading-actions">
          <div className="trace-export-actions">
            <button type="button" onClick={exportMarkdown}>导出 Markdown</button>
            <button type="button" onClick={exportJson}>导出 JSON</button>
          </div>
          <div className={`trace-quality-level is-${result.context.quality.level}`}>
            <span>证据质量</span>
            <strong>{qualityLabel}</strong>
          </div>
        </div>
      </header>

      {exportError && <div className="trace-export-error" role="alert">{exportError}</div>}

      <AnalysisDisclaimer
        title="Trace 分析边界"
        description="当前结论只基于本次录制窗口内的有限事实。缺失采集上下文、未校准时间域或弱关联线索不会被写成确定根因。"
      />

      {isTraceWorkbenchEnabled() && (
        <TraceWorkbenchInternalPanel client={workbenchClient} />
      )}

      <nav className="trace-route-nav" aria-label="Trace 分析导航">
        {TABS.map(item => (
          <button
            aria-current={item.tab === activeTab ? 'page' : undefined}
            className={item.tab === activeTab ? 'is-active' : undefined}
            key={item.tab}
            onClick={() => onTabChange?.(item.tab)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>

      {activeTab === 'conclusion' && (
        <TraceConclusionTab
          observationOnlyMessage={diagnosisViewModel.observationOnlyMessage}
          primary={diagnosisViewModel.primary}
          secondary={diagnosisViewModel.secondary}
          onNavigateEvidence={navigateEvidence}
          onNavigateFact={navigateFact}
        />
      )}
      {activeTab === 'overview' && <TraceOverviewTab result={result} />}
      {activeTab === 'network' && <TraceNetworkTab context={result.context} />}
      {activeTab === 'main-thread' && <TraceMainThreadTab context={result.context} />}
      {activeTab === 'rendering' && <TraceRenderingTab context={result.context} />}
      {activeTab === 'interactions' && <TraceInteractionsTab context={result.context} />}
      {activeTab === 'evidence' && <TraceEvidenceTab evidence={result.context.evidence} />}
    </section>
  );
};

export default TraceResultPage;
