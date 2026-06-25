import { useState, useEffect, useRef } from 'react';
import { Layout, Tabs, Button, message, FloatButton, Dropdown } from 'antd';
import {
  ReloadOutlined,
  DownloadOutlined,
  DashboardOutlined,
  ClockCircleOutlined,
  SafetyOutlined,
  MedicineBoxOutlined,
  UnorderedListOutlined,
  RadarChartOutlined,
  SunOutlined,
  MoonOutlined,
  VerticalAlignTopOutlined,
  GlobalOutlined,
  QuestionCircleOutlined,
  FileTextOutlined,
  CloudUploadOutlined,
  CodeOutlined,
  DownOutlined,
  ApartmentOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';

import { parseLog, ParsedEvent, AnalysisResult, exportReport } from './parsers/netlog';
import { isHarFile, parseHar, HarAnalysisResult } from './harParser';
import { parseLogFile, LogAnalysisResult } from './logParser';
import {
  isWorkerSupported,
  parseNetlogInWorker,
  parseHarInWorker,
  parseLogInWorker,
} from './workers/workerClient';
import { useTheme } from './theme';
import { NavigationProvider, useNavigation } from './contexts/NavigationContext';
import UploadZone from './components/netlog/UploadZone';
import SummaryCards from './components/netlog/SummaryCards';
import OverviewTab from './components/netlog/OverviewTab';
import PerformanceTab from './components/netlog/PerformanceTab';
import SSLTab from './components/netlog/SSLTab';
import ProtocolTab from './components/netlog/ProtocolTab';
import DiagnosisTab from './components/netlog/DiagnosisTab';
import EventsTab from './components/netlog/EventsTab';
import SourceChainViewer from './components/netlog/SourceChainViewer';
import NetLogRequestList from './components/netlog/NetLogRequestList';
import HarResultPage from './components/har/HarResultPage';
import LogResultPage from './components/log/LogResultPage';
import CombinedDiagnosisTab from './components/shared/CombinedDiagnosisTab';
import BaselineCompareTab from './components/shared/BaselineCompareTab';
import RawEvidenceExplorer from './components/raw/RawEvidenceExplorer';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { LoadingOverlay } from './components/shared/LoadingOverlay';
import { AnalysisDisclaimer } from './components/shared/AnalysisDisclaimer';

const { Header, Content } = Layout;

/** 各 fileType 合法的 tab key 集合 */
const VALID_TABS: Record<string, string[]> = {
  netlog: ['overview', 'requests', 'diagnosis', 'combined', 'events', 'source-chain', 'ssl-protocol', 'performance', 'raw-evidence', 'baseline'],
  har: ['requests', 'diagnosis'],
  log: ['overview', 'flows', 'diagnosis', 'performance', 'raw'],
};

function parseHash(hash: string): { fileType?: string; tab?: string } {
  const h = hash.replace('#', '');
  const parts = h.split('/');
  if (parts.length === 2) return { fileType: parts[0], tab: parts[1] };
  if (parts.length === 1) return { tab: parts[0] };
  return {};
}

function buildHash(fileType: string, tab: string): string {
  return `#${fileType}/${tab}`;
}

/** 内部组件：可以使用 useNavigation 监听 tab 切换 */
const AppContent: React.FC = () => {
  const [hasData, setHasData] = useState(false);
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [harResult, setHarResult] = useState<HarAnalysisResult | null>(null);
  const [logResult, setLogResult] = useState<LogAnalysisResult | null>(null);
  const [rawUploadData, setRawUploadData] = useState<unknown>(null);
  const [fileType, setFileType] = useState<'netlog' | 'har' | 'log'>('netlog');
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('正在分析日志数据...');
  const [showBackTop, setShowBackTop] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const { mode, toggleTheme } = useTheme();
  const { intent, navigateTo } = useNavigation();

  // Ref 用于避免连续多文件上传时的 state 异步判断问题
  const resultRef = useRef<AnalysisResult | null>(null);
  const harResultRef = useRef<HarAnalysisResult | null>(null);

  // 从 URL hash 恢复 fileType + tab 状态
  useEffect(() => {
    const { fileType: hashFileType, tab: hashTab } = parseHash(window.location.hash);
    if (hashFileType && hashFileType in VALID_TABS) {
      setFileType(hashFileType as 'netlog' | 'har' | 'log');
    }
    if (hashTab) {
      const resolvedFileType = hashFileType && hashFileType in VALID_TABS ? hashFileType : 'netlog';
      const validTabs = VALID_TABS[resolvedFileType] || [];
      if (validTabs.includes(hashTab)) {
        setActiveTab(hashTab);
      }
    }
  }, []);

  // 监听导航意图，自动切换 tab
  useEffect(() => {
    if (!intent) return;
    setActiveTab(intent.tab);
    window.location.hash = buildHash(fileType, intent.tab);
    // 注意：不在这里 consumeIntent，交给目标 tab 组件消费
  }, [intent, fileType]);

  useEffect(() => {
    const handleScroll = () => {
      setShowBackTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const loadTaskIdRef = useRef(0);
  const activeLoadCountRef = useRef(0);
  const useWorker = isWorkerSupported();

  const finishLoad = () => {
    activeLoadCountRef.current = Math.max(0, activeLoadCountRef.current - 1);
    if (activeLoadCountRef.current === 0) {
      setLoading(false);
    }
  };

  const handleFileLoaded = async (data: unknown, isTextLog = false, repairInfo?: HarAnalysisResult['repairInfo']) => {
    const taskId = ++loadTaskIdRef.current;
    activeLoadCountRef.current += 1;
    setLoading(true);
    setLoadingText('正在识别文件类型...');

    try {
      // 保存原始数据用于 Raw Evidence Explorer
      if (!isTextLog) {
        setRawUploadData(data);
      }

      // 自动识别文件类型
      if (isTextLog && typeof data === 'string') {
        setLoadingText('正在解析日志文件...');
        let logAnalysis;
        if (useWorker) {
          const { result } = await parseLogInWorker(data, {
            onProgress: (phase) => setLoadingText(phase),
          });
          logAnalysis = result;
        } else {
          logAnalysis = parseLogFile(data);
        }
        if (taskId < loadTaskIdRef.current && activeLoadCountRef.current > 1) {
          finishLoad();
          return;
        }
        setLogResult(logAnalysis);
        setFileType('log');
        const defaultTab = VALID_TABS['log'][0];
        setActiveTab(defaultTab);
        window.location.hash = buildHash('log', defaultTab);
        setHasData(true);
        finishLoad();
        message.success(`成功解析 ${logAnalysis.stats.total} 条日志记录`);
        return;
      }

      if (isHarFile(data)) {
        setLoadingText('正在分析 HAR 请求...');
        let harAnalysis;
        if (useWorker) {
          const { result } = await parseHarInWorker(data, repairInfo, {
            onProgress: (phase) => setLoadingText(phase),
          });
          harAnalysis = result;
        } else {
          harAnalysis = parseHar(data);
          if (repairInfo) harAnalysis.repairInfo = repairInfo;
        }
        if (taskId < loadTaskIdRef.current && activeLoadCountRef.current > 1) {
          finishLoad();
          return;
        }
        setHarResult(harAnalysis);
        harResultRef.current = harAnalysis;

        if (resultRef.current) {
          setFileType('netlog');
          setActiveTab('combined');
          window.location.hash = buildHash('netlog', 'combined');
          setHasData(true);
          finishLoad();
          message.success(`成功解析 ${harAnalysis.totalRequests} 个 HAR 请求，已启用联合诊断`);
          return;
        }

        setFileType('har');
        const defaultTab = VALID_TABS['har'][0];
        setActiveTab(defaultTab);
        window.location.hash = buildHash('har', defaultTab);
        setHasData(true);
        finishLoad();
        message.success(`成功解析 ${harAnalysis.totalRequests} 个 HAR 请求`);
        return;
      }

      setLoadingText('正在分析 NetLog 事件...');
      let parsedEvents: ParsedEvent[];
      let analysisResult: AnalysisResult;
      if (useWorker) {
        const workerResult = await parseNetlogInWorker(data, {
          onProgress: (phase) => setLoadingText(phase),
        });
        parsedEvents = workerResult.events;
        analysisResult = workerResult.result;
      } else {
        const syncResult = parseLog(data);
        parsedEvents = syncResult.events;
        analysisResult = syncResult.result;
      }
      if (taskId < loadTaskIdRef.current && activeLoadCountRef.current > 1) {
        finishLoad();
        return;
      }
      setEvents(parsedEvents);
      setResult(analysisResult);
      resultRef.current = analysisResult;

      if (harResultRef.current) {
        setFileType('netlog');
        setActiveTab('combined');
        window.location.hash = buildHash('netlog', 'combined');
        setHasData(true);
        finishLoad();
        message.success(`成功解析 ${parsedEvents.length} 个事件，已启用联合诊断`);
        return;
      }

      setFileType('netlog');
      const defaultTab = VALID_TABS['netlog'][0];
      setActiveTab(defaultTab);
      window.location.hash = buildHash('netlog', defaultTab);
      setHasData(true);
      finishLoad();
      message.success(`成功解析 ${parsedEvents.length} 个事件`);
    } catch (err) {
      if (taskId < loadTaskIdRef.current && activeLoadCountRef.current > 1) {
        finishLoad();
        return;
      }
      finishLoad();
      message.error('解析失败: ' + (err as Error).message);
    }
  };

  // 追加上传：支持在已有数据基础上追加另一类型文件
  const handleSecondaryFileLoaded = async (
    data: unknown,
    isTextLog = false,
    repairInfo?: HarAnalysisResult['repairInfo']
  ) => {
    activeLoadCountRef.current += 1;
    setLoading(true);
    setLoadingText('正在解析追加文件...');

    try {
      if (isTextLog && typeof data === 'string') {
        message.warning('追加 .log 文件不支持联合诊断，请上传 HAR 或 NetLog');
        finishLoad();
        return;
      }

      if (isHarFile(data)) {
        let harAnalysis;
        if (useWorker) {
          const { result } = await parseHarInWorker(data, repairInfo, {
            onProgress: (phase) => setLoadingText(phase),
          });
          harAnalysis = result;
        } else {
          harAnalysis = parseHar(data);
          if (repairInfo) harAnalysis.repairInfo = repairInfo;
        }

        setHarResult(harAnalysis);
        harResultRef.current = harAnalysis;

        if (resultRef.current) {
          setFileType('netlog');
          setActiveTab('combined');
          window.location.hash = buildHash('netlog', 'combined');
          message.success(`追加 HAR 成功（${harAnalysis.totalRequests} 请求），联合诊断已启用`);
        } else {
          setFileType('har');
          setActiveTab('requests');
          window.location.hash = buildHash('har', 'requests');
          message.success(`追加 HAR 成功（${harAnalysis.totalRequests} 请求）`);
        }

        setHasData(true);
        finishLoad();
        return;
      }

      let parsedEvents: ParsedEvent[];
      let analysisResult: AnalysisResult;
      if (useWorker) {
        const workerResult = await parseNetlogInWorker(data, {
          onProgress: (phase) => setLoadingText(phase),
        });
        parsedEvents = workerResult.events;
        analysisResult = workerResult.result;
      } else {
        const syncResult = parseLog(data);
        parsedEvents = syncResult.events;
        analysisResult = syncResult.result;
      }

      setEvents(parsedEvents);
      setResult(analysisResult);
      resultRef.current = analysisResult;

      if (harResultRef.current) {
        setFileType('netlog');
        setActiveTab('combined');
        window.location.hash = buildHash('netlog', 'combined');
        message.success(`追加 NetLog 成功（${parsedEvents.length} 事件），联合诊断已启用`);
      } else {
        setFileType('netlog');
        setActiveTab('overview');
        window.location.hash = buildHash('netlog', 'overview');
        message.success(`追加 NetLog 成功（${parsedEvents.length} 事件）`);
      }

      setHasData(true);
      finishLoad();
    } catch (err) {
      finishLoad();
      message.error('追加文件解析失败: ' + (err as Error).message);
    }
  };

  const handleReset = () => {
    setHasData(false);
    setEvents([]);
    setResult(null);
    setHarResult(null);
    setLogResult(null);
    setRawUploadData(null);
    activeLoadCountRef.current = 0;
    resultRef.current = null;
    harResultRef.current = null;
    setFileType('netlog');
    setActiveTab('overview');
    window.location.hash = '';
  };



  const handleExport = () => {
    if (!result) return;
    const report = exportReport(result);
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `netlog-analysis-report-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('报告已导出');
  };

  const handleExportJSON = () => {
    if (!result) return;
    const data = {
      exportTime: new Date().toISOString(),
      overview: {
        totalEvents: result.totalEvents,
        uniqueSources: result.uniqueSources,
        peakConcurrency: result.peakConcurrency,
        urlRequestCount: result.urlRequests.length,
        errorCount: result.errors.length,
        warningCount: result.warnings.length,
        slowRequestCount: result.slowRequests.length,
      },
      proxyInfo: result.proxyInfo,
      requests: result.urlRequests.map(r => ({
        url: r.url,
        method: r.method,
        status: r.status,
        statusCode: r.statusCode,
        duration: r.duration,
        error: r.error,
        timeline: r.timeline,
      })),
      errors: result.errors.map(e => ({ severity: e.severity, category: e.category, message: e.message, detail: e.detail, time: e.time })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `netlog-analysis-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('JSON 数据已导出');
  };

  const handleExportCSV = () => {
    if (!result) return;
    const headers = ['URL', 'Method', 'Status', 'StatusCode', 'Duration(ms)', 'Error', 'DNS(ms)', 'Connect(ms)', 'SSL(ms)', 'Send(ms)', 'Wait(ms)', 'Download(ms)'];
    const rows = result.urlRequests.map(r => [
      r.url, r.method, r.status, r.statusCode || '', r.duration || '',
      r.error || '',
      r.timeline.dns?.duration || '', r.timeline.connect?.duration || '',
      r.timeline.ssl?.duration || '', r.timeline.send?.duration || '',
      r.timeline.wait?.duration || '', r.timeline.download?.duration || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `netlog-requests-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('CSV 请求列表已导出');
  };

  const tabItems = [
    { key: 'overview', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><DashboardOutlined />总览</span>, children: result ? <OverviewTab result={result} /> : null },
    { key: 'requests', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><GlobalOutlined />请求瀑布</span>, children: result ? <NetLogRequestList result={result} /> : null },
    { key: 'diagnosis', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MedicineBoxOutlined />定因诊断</span>, children: result ? <DiagnosisTab result={result} /> : null },
    { key: 'combined', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><RadarChartOutlined />联合诊断</span>, children: result ? (
      <CombinedDiagnosisTab harResult={harResult} netlogResult={result} onUploadMissingFile={handleSecondaryFileLoaded} />
    ) : null },
    { key: 'events', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><UnorderedListOutlined />事件列表</span>, children: <EventsTab events={events} /> },
    { key: 'source-chain', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ApartmentOutlined />源链路</span>, children: result ? (
      <SourceChainViewer
        events={events}
        urlRequests={result.urlRequests}
        onNavigateToSource={(sourceId) => {
          navigateTo({
            tab: 'events',
            filters: { sourceId: String(sourceId) },
            source: '源链路',
            reason: '查看 source 事件',
          });
        }}
      />
    ) : null },
    { key: 'ssl-protocol', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><SafetyOutlined />安全与协议</span>, children: result ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <SSLTab result={result} />
        <ProtocolTab result={result} />
      </div>
    ) : null },
    { key: 'performance', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ClockCircleOutlined />性能分析</span>, children: result ? <PerformanceTab result={result} /> : null },
    { key: 'raw-evidence', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileSearchOutlined />原始证据</span>, children: rawUploadData ? <RawEvidenceExplorer rawData={rawUploadData} /> : null },
    { key: 'baseline', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileTextOutlined />A-B 对比</span>, children: <BaselineCompareTab /> },
  ];

  return (
    <ErrorBoundary onReset={handleReset}>
      <LoadingOverlay visible={loading} phase={loadingText} message="请稍候，正在提取事件、统计指标和诊断信息" />
      <Layout style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* ====== Modern Header ====== */}
      <Header className="app-header">
        <div className="app-header-title">
          {/* Logo icon - Network/Radar themed */}
          <div
            style={{
              width: 38,
              height: 38,
              background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
              borderRadius: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(14, 165, 233, 0.25)',
            }}
          >
            <RadarChartOutlined style={{ color: '#fff', fontSize: 20 }} />
          </div>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
                letterSpacing: 0.3,
                lineHeight: 1.3,
              }}
            >
              浏览器文件分析工具
            </h1>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
              Chrome / Edge NetLog 与 HAR 文件可视化分析
            </div>
          </div>
        </div>

        <div className="app-header-actions">
          {/* Theme Toggle Button */}
          <Button
            icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggleTheme}
            size="large"
            style={{
              background: mode === 'dark'
                ? 'linear-gradient(135deg, #f59e0b, #fbbf24)'
                : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              border: 'none',
              color: '#fff',
              fontWeight: 600,
              fontSize: 15,
              height: 40,
              padding: '0 18px',
              borderRadius: 10,
              boxShadow: mode === 'dark'
                ? '0 2px 12px rgba(245, 158, 11, 0.35)'
                : '0 2px 12px rgba(99, 102, 241, 0.35)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            title={mode === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          >
            {mode === 'dark' ? '浅色' : '深色'}
          </Button>

          {hasData && (
            <>
              <Button
                icon={<ReloadOutlined />}
                onClick={handleReset}
                style={{
                  background: 'var(--bg-elevated)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-secondary)',
                }}
              >
                重新上传
              </Button>
              {fileType === 'netlog' && (
                <Dropdown
                  menu={{
                    items: [
                      { key: 'md', label: 'Markdown 报告', icon: <FileTextOutlined />, onClick: handleExport },
                      { key: 'json', label: 'JSON 数据', icon: <CodeOutlined />, onClick: handleExportJSON },
                      { key: 'csv', label: 'CSV 请求列表', icon: <UnorderedListOutlined />, onClick: handleExportCSV },
                    ],
                  }}
                >
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    style={{
                      background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                      border: 'none',
                      fontWeight: 600,
                      boxShadow: '0 2px 8px rgba(14, 165, 233, 0.25)',
                    }}
                  >
                    导出报告 <DownOutlined />
                  </Button>
                </Dropdown>
              )}
            </>
          )}
        </div>
      </Header>

      {/* ====== Main Content ====== */}
      <Content style={{ width: '100%', boxSizing: 'border-box' }}>
        {!hasData ? (
          <div style={{ maxWidth: 900, margin: '48px auto', display: 'flex', flexDirection: 'column', gap: 32 }}>
            <UploadZone onFileLoaded={handleFileLoaded} multiple />

            {/* 使用说明 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <QuestionCircleOutlined style={{ fontSize: 16, color: 'var(--accent-blue)' }} />
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>不知道如何获取文件？</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                {/* HAR 文件 */}
                <a
                  href="https://bytedance.larkoffice.com/wiki/NbIuwtlAKi0C1nk2SkdcLcjTnDb"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block',
                    padding: '20px 24px',
                    background: 'var(--bg-surface)',
                    borderRadius: 14,
                    border: '1px solid var(--border-color)',
                    textDecoration: 'none',
                    transition: 'all 0.2s',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--accent-blue)';
                    e.currentTarget.style.boxShadow = '0 4px 16px rgba(14, 165, 233, 0.12)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(99, 102, 241, 0.12))',
                        border: '1px solid rgba(14, 165, 233, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <FileTextOutlined style={{ fontSize: 20, color: '#0ea5e9' }} />
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>HAR 文件获取指南</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    通过浏览器 DevTools → Network 面板导出网络请求记录
                  </p>
                  <span style={{ fontSize: 12, color: 'var(--accent-blue)', marginTop: 8, display: 'inline-block' }}>
                    查看详细教程 →
                  </span>
                </a>

                {/* NetLog 文件 */}
                <a
                  href="https://bytedance.larkoffice.com/docx/NfwtdMpCLoh04yx0xnec1PXCnnf"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block',
                    padding: '20px 24px',
                    background: 'var(--bg-surface)',
                    borderRadius: 14,
                    border: '1px solid var(--border-color)',
                    textDecoration: 'none',
                    transition: 'all 0.2s',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = '#6366f1';
                    e.currentTarget.style.boxShadow = '0 4px 16px rgba(99, 102, 241, 0.12)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(139, 92, 246, 0.12))',
                        border: '1px solid rgba(99, 102, 241, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <CloudUploadOutlined style={{ fontSize: 20, color: '#6366f1' }} />
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>NetLog 文件获取指南</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    通过 chrome://net-export/ 或 edge://net-export/ 导出网络日志
                  </p>
                  <span style={{ fontSize: 12, color: '#6366f1', marginTop: 8, display: 'inline-block' }}>
                    查看详细教程 →
                  </span>
                </a>

                {/* Go 服务日志文件 */}
                <a
                  href="https://bytedance.larkoffice.com/wiki/O6UJwfl0UivPlBk7pCHcrzxfnJd"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block',
                    padding: '20px 24px',
                    background: 'var(--bg-surface)',
                    borderRadius: 14,
                    border: '1px solid var(--border-color)',
                    textDecoration: 'none',
                    transition: 'all 0.2s',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = '#22d3ee';
                    e.currentTarget.style.boxShadow = '0 4px 16px rgba(34, 211, 238, 0.12)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: 'linear-gradient(135deg, rgba(34, 211, 238, 0.12), rgba(14, 165, 233, 0.12))',
                        border: '1px solid rgba(34, 211, 238, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <CodeOutlined style={{ fontSize: 20, color: '#22d3ee' }} />
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Go 服务日志获取指南</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    从 Go 服务标准输出或日志文件导出结构化日志
                  </p>
                  <span style={{ fontSize: 12, color: '#22d3ee', marginTop: 8, display: 'inline-block' }}>
                    查看详细教程 →
                  </span>
                </a>
              </div>
            </div>
          </div>
        ) : fileType === 'har' && harResult ? (
          <div style={{ padding: '24px 28px' }}>
            <HarResultPage
              result={harResult}
              activeTab={activeTab}
              onTabChange={(key) => {
                setActiveTab(key);
                window.location.hash = buildHash(fileType, key);
              }}
            />
            {/* 追加 NetLog，进入联合诊断 */}
            {!result && (
              <div style={{ marginTop: 24, padding: '20px 24px', background: 'var(--bg-surface)', borderRadius: 14, border: '1px dashed var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <RadarChartOutlined style={{ color: '#6366f1' }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>追加 NetLog，进入联合诊断</span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  当前已加载 HAR。追加上传同一次问题复现导出的 NetLog 文件后，将自动进入 NetLog 页面中的联合诊断 Tab。
                </p>
                <UploadZone onFileLoaded={handleSecondaryFileLoaded} compact />
              </div>
            )}
          </div>
        ) : fileType === 'log' && logResult ? (
          <div style={{ padding: '24px 28px' }}>
            <LogResultPage
              result={logResult}
              activeTab={activeTab}
              onTabChange={(key) => {
                setActiveTab(key);
                window.location.hash = buildHash(fileType, key);
              }}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: '24px 28px' }}>
            {result && <SummaryCards result={result} onNavigate={(tab, search) => {
              if (search) {
                navigateTo({
                  tab,
                  filters: search === 'net_error' ? { errorOnly: true } : { keyword: search },
                  source: '概览卡片',
                  reason: '点击摘要卡片',
                });
                return;
              }
              setActiveTab(tab);
              window.location.hash = buildHash(fileType, tab);
            }} />}
            <AnalysisDisclaimer variant="netlog" />
            <div
              style={{
                background: 'var(--bg-surface)',
                borderRadius: 14,
                border: '1px solid var(--border-color)',
                overflow: 'hidden',
                boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
              }}
            >
              <Tabs
                activeKey={activeTab}
                onChange={(key) => {
                  setActiveTab(key);
                  window.location.hash = buildHash(fileType, key);
                }}
                items={tabItems}
                type="card"
                style={{
                  background: 'var(--bg-surface)',
                }}
              />
            </div>
          </div>
        )}
      </Content>

      {/* Back to Top Button */}
      {showBackTop && (
        <FloatButton
          icon={<VerticalAlignTopOutlined />}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          style={{
            position: 'fixed',
            right: 32,
            bottom: 32,
            zIndex: 999,
          }}
          tooltip="回到顶部"
        />
      )}
    </Layout>
    </ErrorBoundary>
  );
};

const App: React.FC = () => (
  <NavigationProvider>
    <AppContent />
  </NavigationProvider>
);

export default App;
