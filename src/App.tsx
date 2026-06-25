import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Layout, Tabs, Button, message, FloatButton, Dropdown } from 'antd';
import {
  ReloadOutlined,
  DownloadOutlined,
  DashboardOutlined,
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

import { parseLog } from './parsers/netlog';
import { isHarFile, parseHar, HarAnalysisResult } from './harParser';
import { parseLogFile, LogAnalysisResult } from './logParser';
import {
  isWorkerSupported,
  parseNetlogInWorker,
  parseHarInWorker,
  parseLogInWorker,
  releaseRawDataInWorker,
  releaseAnalysisInWorker,
} from './workers/workerClient';
import type { HarSummary, NetlogSummary } from './workers/summaryTypes';
import { useTheme } from './theme';
import { NavigationProvider, useNavigation } from './contexts/NavigationContext';
import UploadZone from './components/netlog/UploadZone';
import SummaryCards from './components/netlog/SummaryCards';
import OverviewTab from './components/netlog/OverviewTab';
import DiagnosisTab from './components/netlog/DiagnosisTab';
import EventsTab from './components/netlog/EventsTab';
import SourceChainViewer from './components/netlog/SourceChainViewer';
import NetLogRequestList from './components/netlog/NetLogRequestList';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { LoadingOverlay } from './components/shared/LoadingOverlay';
import { AnalysisDisclaimer } from './components/shared/AnalysisDisclaimer';

const { Header, Content } = Layout;

// 页面级懒加载：减少首包体积（重型模块拆分）
const LogResultPage = lazy(() => import('./components/log/LogResultPage'));
const RawEvidenceExplorer = lazy(() => import('./components/raw/RawEvidenceExplorer'));

const LazyFallback: React.FC<{ text?: string }> = ({ text = '正在加载模块...' }) => (
  <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
    {text}
  </div>
);

/** 各 fileType 合法的 tab key 集合 */
const VALID_TABS: Record<string, string[]> = {
  netlog: ['overview', 'requests', 'diagnosis', 'events', 'source-chain', 'raw-evidence'],
  har: ['raw-evidence'],
  log: ['overview', 'flows', 'performance', 'raw'],
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
  const [netlogAnalysisId, setNetlogAnalysisId] = useState<string | null>(null);
  const [netlogSummary, setNetlogSummary] = useState<NetlogSummary | null>(null);
  const [harAnalysisId, setHarAnalysisId] = useState<string | null>(null);
  const [harSummary, setHarSummary] = useState<HarSummary | null>(null);
  const [logResult, setLogResult] = useState<LogAnalysisResult | null>(null);
  const [rawDataIdByType, setRawDataIdByType] = useState<{ har?: string; netlog?: string }>({});
  const [fileType, setFileType] = useState<'netlog' | 'har' | 'log'>('netlog');
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('正在分析日志数据...');
  const [showBackTop, setShowBackTop] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const { mode, toggleTheme } = useTheme();
  const { intent, navigateTo } = useNavigation();

  // Ref 用于避免连续多文件上传时的 state 异步判断问题
  const netlogSummaryRef = useRef<NetlogSummary | null>(null);
  const harSummaryRef = useRef<HarSummary | null>(null);

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
    const nextFileType =
      intent.fileType && intent.fileType in VALID_TABS
        ? (intent.fileType as 'netlog' | 'har' | 'log')
        : fileType;
    if (nextFileType !== fileType) {
      setFileType(nextFileType);
    }
    setActiveTab(intent.tab);
    window.location.hash = buildHash(nextFileType, intent.tab);
    // 注意：不在这里 consumeIntent，交给目标 tab 组件消费
  }, [intent, fileType]);

  const rememberRawDataId = (type: 'har' | 'netlog', rawDataId?: string) => {
    setRawDataIdByType((prev) => ({ ...prev, [type]: rawDataId }));
  };

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

  const handleFileLoaded = async (
    data: unknown,
    isTextLog = false,
    repairInfo?: HarAnalysisResult['repairInfo'],
    fileTypeHint?: 'netlog' | 'har' | 'log'
  ) => {
    const taskId = ++loadTaskIdRef.current;
    activeLoadCountRef.current += 1;
    setLoading(true);
    setLoadingText('正在识别文件类型...');

    try {
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

      const shouldParseHar = fileTypeHint === 'har' || (typeof data !== 'string' && isHarFile(data));
      if (shouldParseHar) {
        setLoadingText('正在分析 HAR 请求...');
        let harAnalysis: HarAnalysisResult | null = null;
        let harSummaryResult: HarSummary | null = null;
        let harAnalysisIdNext: string | null = null;
        let harRawDataId: string | undefined = undefined;
        if (useWorker) {
          const { analysisId, summary, rawDataId } = await parseHarInWorker(data, repairInfo, {
            onProgress: (phase) => setLoadingText(phase),
          });
          harSummaryResult = summary;
          harAnalysisIdNext = analysisId;
          harRawDataId = rawDataId;
        } else {
          const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
          harAnalysis = parseHar(parsedData);
          if (repairInfo) harAnalysis.repairInfo = repairInfo;
          // 非 Worker 模式：退化为主线程解析（不满足大文件性能目标）
          harSummaryResult = {
            kind: 'har',
            totalRequests: harAnalysis.totalRequests,
            failedRequests: harAnalysis.failedCount,
            slowRequests: harAnalysis.slowCount,
            domainCount: new Set(harAnalysis.entries.map(e => e.domain)).size,
            slowEntryPreviews: harAnalysis.entries.filter(e => e.isSlow).slice(0, 20).map(e => ({
              id: e.id,
              url: e.url,
              method: e.method,
              status: e.status,
              time: e.time,
              startMs: e.startMs,
              domain: e.domain,
              path: e.name,
              isSlow: e.isSlow,
              isFailed: e.isFailed,
              xTtLogid: e.xTtLogid,
            })),
            repairInfo: harAnalysis.repairInfo,
          };
        }
        if (taskId < loadTaskIdRef.current && activeLoadCountRef.current > 1) {
          finishLoad();
          return;
        }
        if (useWorker && harAnalysisIdNext && harAnalysisId && harAnalysisId !== harAnalysisIdNext) {
          void releaseAnalysisInWorker({ analysisId: harAnalysisId });
        }
        setHarSummary(harSummaryResult);
        harSummaryRef.current = harSummaryResult;
        setHarAnalysisId(harAnalysisIdNext);
        if (useWorker && harRawDataId && rawDataIdByType.har && rawDataIdByType.har !== harRawDataId) {
          void releaseRawDataInWorker({ rawDataId: rawDataIdByType.har });
        }
        rememberRawDataId('har', harRawDataId);

        setFileType('har');
        const defaultTab = VALID_TABS['har'][0];
        setActiveTab(defaultTab);
        window.location.hash = buildHash('har', defaultTab);
        setHasData(true);
        finishLoad();
        message.success(`成功解析 ${harSummaryResult?.totalRequests ?? 0} 个 HAR 请求`);
        return;
      }

      setLoadingText('正在分析 NetLog 事件...');
      let netlogSummaryResult: NetlogSummary | null = null;
      let netlogAnalysisIdNext: string | null = null;
      let eventCount = 0;
      let requestCount = 0;
      let netlogRawDataId: string | undefined = undefined;
      if (useWorker) {
        const workerResult = await parseNetlogInWorker(data, {
          onProgress: (phase) => setLoadingText(phase),
        });
        netlogSummaryResult = workerResult.summary;
        netlogAnalysisIdNext = workerResult.analysisId;
        eventCount = workerResult.eventCount;
        requestCount = workerResult.requestCount;
        netlogRawDataId = workerResult.rawDataId;
      } else {
        const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        const syncResult = parseLog(parsedData);
        eventCount = syncResult.events.length;
        requestCount = syncResult.result.urlRequests.length;
        // 非 Worker 模式：退化为主线程解析（不满足大文件性能目标）
        netlogSummaryResult = {
          kind: 'netlog',
          totalEvents: syncResult.result.totalEvents,
          uniqueSources: syncResult.result.uniqueSources,
          peakConcurrency: syncResult.result.peakConcurrency,
          timeRange: syncResult.result.timeRange,
          protocols: syncResult.result.protocols,
          issueCounts: {
            error: syncResult.result.errors.length,
            warning: syncResult.result.warnings.length,
            info: syncResult.result.info.length,
          },
          proxyInfo: syncResult.result.proxyInfo,
          systemInfo: syncResult.result.systemInfo,
          requestCount,
          slowRequestPreviews: syncResult.result.slowRequests.slice(0, 20).map(r => ({
            id: r.id,
            url: r.url,
            method: r.method,
            startTime: r.startTime,
            endTime: r.endTime,
            duration: r.duration,
            status: r.status,
            statusCode: r.statusCode,
            error: r.error,
            errorDesc: r.errorDesc,
            resolvedIp: r.resolvedIp,
            remoteIp: r.remoteIp,
            protocol: r.protocol,
            timeline: {
              dns: r.timeline?.dns?.duration,
              connect: r.timeline?.connect?.duration,
              ssl: r.timeline?.ssl?.duration,
              send: r.timeline?.send?.duration,
              wait: r.timeline?.wait?.duration,
              download: r.timeline?.download?.duration,
            },
          })),
          failedDomainPreviews: syncResult.result.failedDomains.slice(0, 20).map(d => ({
            domain: d.domain,
            count: d.count,
            errorCodes: d.errorCodes,
            firstTime: d.firstTime,
            lastTime: d.lastTime,
          })),
        };
      }
      if (taskId < loadTaskIdRef.current && activeLoadCountRef.current > 1) {
        finishLoad();
        return;
      }
      if (useWorker && netlogAnalysisIdNext && netlogAnalysisId && netlogAnalysisId !== netlogAnalysisIdNext) {
        void releaseAnalysisInWorker({ analysisId: netlogAnalysisId });
      }
      setNetlogSummary(netlogSummaryResult);
      netlogSummaryRef.current = netlogSummaryResult;
      setNetlogAnalysisId(netlogAnalysisIdNext);
      if (useWorker && netlogRawDataId && rawDataIdByType.netlog && rawDataIdByType.netlog !== netlogRawDataId) {
        void releaseRawDataInWorker({ rawDataId: rawDataIdByType.netlog });
      }
      rememberRawDataId('netlog', netlogRawDataId);

      setFileType('netlog');
      const defaultTab = VALID_TABS['netlog'][0];
      setActiveTab(defaultTab);
      window.location.hash = buildHash('netlog', defaultTab);
      setHasData(true);
      finishLoad();
      message.success(`成功解析 ${eventCount} 个事件`);
    } catch (err) {
      if (taskId < loadTaskIdRef.current && activeLoadCountRef.current > 1) {
        finishLoad();
        return;
      }
      finishLoad();
      message.error('解析失败: ' + (err as Error).message);
    }
  };

  const handleReset = () => {
    setHasData(false);
    setNetlogAnalysisId(null);
    setNetlogSummary(null);
    setHarAnalysisId(null);
    setHarSummary(null);
    setLogResult(null);
    setRawDataIdByType({});
    if (useWorker) {
      void releaseAnalysisInWorker({ all: true });
      void releaseRawDataInWorker({ all: true });
    }
    activeLoadCountRef.current = 0;
    netlogSummaryRef.current = null;
    harSummaryRef.current = null;
    setFileType('netlog');
    setActiveTab('overview');
    window.location.hash = '';
  };



  const handleExport = () => {
    message.info('性能模式下暂不支持导出全量 Markdown（后续将改为 Worker 侧按需导出）');
  };

  const handleExportJSON = () => {
    message.info('性能模式下暂不支持导出全量 JSON（后续将改为 Worker 侧按需导出）');
  };

  const handleExportCSV = () => {
    message.info('性能模式下暂不支持导出全量 CSV（后续将改为 Worker 侧按需导出）');
  };

  const tabItems = [
    { key: 'overview', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><DashboardOutlined />总览</span>, children: netlogSummary ? <OverviewTab summary={netlogSummary} /> : null },
    { key: 'requests', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><GlobalOutlined />请求瀑布</span>, children: netlogAnalysisId ? <NetLogRequestList analysisId={netlogAnalysisId} timeRange={netlogSummary?.timeRange} /> : null },
    { key: 'diagnosis', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MedicineBoxOutlined />定因诊断</span>, children: netlogAnalysisId ? <DiagnosisTab analysisId={netlogAnalysisId} /> : null },
    { key: 'events', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><UnorderedListOutlined />事件列表</span>, children: netlogAnalysisId ? <EventsTab analysisId={netlogAnalysisId} /> : null },
    { key: 'source-chain', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ApartmentOutlined />源链路</span>, children: netlogAnalysisId ? (
      <SourceChainViewer
        analysisId={netlogAnalysisId}
        onNavigateToSource={(sourceId) => {
          navigateTo({
            tab: 'events',
            fileType: 'netlog',
            evidenceSource: 'netlog',
            filters: { sourceId: String(sourceId) },
            source: '源链路',
            reason: '查看 source 事件',
          });
        }}
      />
    ) : null },
    {
      key: 'raw-evidence',
      label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileSearchOutlined />原始证据</span>,
      children: rawDataIdByType.netlog ? (
        <Suspense fallback={<LazyFallback text="正在加载原始证据模块..." />}>
          <RawEvidenceExplorer rawDataId={rawDataIdByType.netlog} fileName="NetLog 原始证据" />
        </Suspense>
      ) : null,
    },
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
        ) : fileType === 'har' && harSummary ? (
          <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <AnalysisDisclaimer variant="har" />
            <div style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border-color)', padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>HAR 摘要</div>
              <div style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
                请求数：{harSummary.totalRequests} · 失败：{harSummary.failedRequests} · 慢请求：{harSummary.slowRequests} · 域名数：{harSummary.domainCount}
              </div>
              <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 12 }}>
                说明：性能专项期间 HAR 详细列表页正在迁移到 Worker query 模式，当前先保留摘要与原始证据能力。
              </div>
            </div>
            {rawDataIdByType.har && (
              <Suspense fallback={<LazyFallback text="正在加载原始证据模块..." />}>
                <RawEvidenceExplorer rawDataId={rawDataIdByType.har} fileName="HAR 原始证据" />
              </Suspense>
            )}
          </div>
        ) : fileType === 'log' && logResult ? (
          <div style={{ padding: '24px 28px' }}>
            <Suspense fallback={<LazyFallback text="正在加载日志页面..." />}>
              <LogResultPage
                result={logResult}
                activeTab={activeTab}
                onTabChange={(key) => {
                  setActiveTab(key);
                  window.location.hash = buildHash(fileType, key);
                }}
              />
            </Suspense>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: '24px 28px' }}>
            {netlogSummary && <SummaryCards summary={netlogSummary} onNavigate={(tab, search) => {
              if (search) {
                navigateTo({
                  tab,
                  fileType: 'netlog',
                  evidenceSource: 'netlog',
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
