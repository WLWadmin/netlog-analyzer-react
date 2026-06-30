import { useState, useEffect, useRef, lazy, Suspense, useCallback } from 'react';
import { Layout, Button, message, FloatButton, Dropdown } from 'antd';
import {
  ReloadOutlined,
  DownloadOutlined,
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
  FileSearchOutlined,
} from '@ant-design/icons';

import { ParsedEvent, AnalysisResult, exportReport } from './parsers/netlog';
import { HarAnalysisResult } from './harParser';
import { LogAnalysisResult } from './logParser';
import {
  isWorkerSupported,
  releaseRawDataInWorker,
} from './workers/workerClient';
import { parseUploadedInput } from './upload/parseUploadedInput';
import { useTheme } from './theme';
import { NavigationProvider, useNavigation } from './contexts/NavigationContext';
import UploadZone from './components/netlog/UploadZone';
import SummaryCards from './components/netlog/SummaryCards';
import NetLogRequestList from './components/netlog/NetLogRequestList';
import ConclusionActionTab from './components/netlog/ConclusionActionTab';
import EvidenceChainTab from './components/netlog/EvidenceChainTab';
import ExpertAnalysisTab from './components/netlog/ExpertAnalysisTab';
import NetlogWorkbenchNav from './components/netlog/NetlogWorkbenchNav';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { LoadingOverlay } from './components/shared/LoadingOverlay';
import { AnalysisDisclaimer } from './components/shared/AnalysisDisclaimer';
import { buildAppHash, parseAppHash, type FileType } from './utils/hashRouting';
import type { IpRoutingConclusion } from './diagnosis/ipEvidence';

const { Header, Content } = Layout;

// 页面级懒加载：减少首包体积（重型模块拆分）
const HarResultPage = lazy(() => import('./components/har/HarResultPage'));
const LogResultPage = lazy(() => import('./components/log/LogResultPage'));
const RawEvidenceExplorer = lazy(() => import('./components/raw/RawEvidenceExplorer'));

const LazyFallback: React.FC<{ text?: string }> = ({ text = '正在加载模块...' }) => (
  <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
    {text}
  </div>
);

/** 各 fileType 合法的 tab key 集合 */
const VALID_TABS: Record<string, string[]> = {
  netlog: ['conclusion', 'requests', 'evidence', 'expert', 'raw'],
  har: ['requests', 'summary', 'raw-evidence'],
  log: ['overview', 'flows', 'performance', 'raw'],
};

/** 内部组件：可以使用 useNavigation 监听 tab 切换 */
const AppContent: React.FC = () => {
  const [hasData, setHasData] = useState(false);
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [harResult, setHarResult] = useState<HarAnalysisResult | null>(null);
  const [logResult, setLogResult] = useState<LogAnalysisResult | null>(null);
  const [rawUploadDataByType, setRawUploadDataByType] = useState<{ har?: unknown; netlog?: unknown; log?: unknown }>({});
  const [rawDataIdByType, setRawDataIdByType] = useState<{ har?: string; netlog?: string }>({});
  const [fileType, setFileType] = useState<'netlog' | 'har' | 'log'>('netlog');
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('正在分析日志数据...');
  const [showBackTop, setShowBackTop] = useState(false);
  const [activeTab, setActiveTab] = useState('conclusion');
  const [activeSubTab, setActiveSubTab] = useState<string | undefined>();
  const [ipRoutingConclusions, setIpRoutingConclusions] = useState<IpRoutingConclusion[]>([]);
  const { mode, toggleTheme } = useTheme();
  const { intent, navigateTo } = useNavigation();

  // Ref 用于避免连续多文件上传时的 state 异步判断问题
  const resultRef = useRef<AnalysisResult | null>(null);
  const harResultRef = useRef<HarAnalysisResult | null>(null);
  const rawDataIdByTypeRef = useRef(rawDataIdByType);

  // 从 URL hash 恢复 fileType + tab 状态
  useEffect(() => {
    const { fileType: hashFileType, tab: hashTab, subTab: hashSubTab } = parseAppHash(window.location.hash);
    if (hashFileType && hashFileType in VALID_TABS) {
      setFileType(hashFileType);
    }
    if (hashTab) {
      const resolvedFileType = hashFileType && hashFileType in VALID_TABS ? hashFileType : 'netlog';
      const validTabs = VALID_TABS[resolvedFileType] || [];
      if (validTabs.includes(hashTab)) {
        setActiveTab(hashTab);
        setActiveSubTab(hashTab === 'expert' ? (hashSubTab || 'events') : undefined);
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
    const parsed = parseAppHash(buildAppHash(nextFileType as FileType, intent.tab));
    const nextTab = parsed.tab || intent.tab;
    const nextSubTab = parsed.subTab || (nextTab === 'expert' ? 'events' : undefined);
    setActiveTab(nextTab);
    setActiveSubTab(nextSubTab);
    window.location.hash = buildAppHash(nextFileType as FileType, nextTab, nextSubTab);
    // 注意：不在这里 consumeIntent，交给目标 tab 组件消费
  }, [intent, fileType]);

  const rememberRawData = (type: 'har' | 'netlog' | 'log', rawData?: unknown, rawDataId?: string) => {
    setRawUploadDataByType((prev) => ({ ...prev, [type]: rawData }));
    if (type === 'har' || type === 'netlog') {
      setRawDataIdByType((prev) => ({ ...prev, [type]: rawDataId }));
    }
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

  useEffect(() => {
    rawDataIdByTypeRef.current = rawDataIdByType;
  }, [rawDataIdByType]);

  const releaseRawDataId = useCallback((rawDataId?: string) => {
    if (!rawDataId || !isWorkerSupported()) return;
    void releaseRawDataInWorker({ rawDataId }).catch(() => {
      // 释放失败不影响解析和浏览流程，Worker LRU 仍会兜底控制内存上限
    });
  }, []);

  useEffect(() => {
    return () => {
      if (isWorkerSupported()) {
        void releaseRawDataInWorker({ all: true }).catch(() => {
          // 页面卸载时释放失败不阻塞浏览器关闭流程
        });
      }
    };
  }, []);

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
    setIpRoutingConclusions([]);

    try {
      const parsed = await parseUploadedInput({
        data,
        isTextLog,
        repairInfo,
        fileTypeHint,
        useWorker,
        onProgress: (phase) => setLoadingText(phase),
      });

      if (parsed.kind === 'log') {
        if (taskId < loadTaskIdRef.current && activeLoadCountRef.current > 1) {
          finishLoad();
          return;
        }
        setLogResult(parsed.result);
        setFileType('log');
        setActiveTab('overview');
        setActiveSubTab(undefined);
        window.location.hash = buildAppHash('log', 'overview');
        setHasData(true);
        finishLoad();
        message.success(`成功解析 ${parsed.result.stats.total} 条日志记录`);
        return;
      }

      if (parsed.kind === 'har') {
        if (taskId < loadTaskIdRef.current && activeLoadCountRef.current > 1) {
          if (useWorker && parsed.rawDataId) {
            releaseRawDataId(parsed.rawDataId);
          }
          finishLoad();
          return;
        }
        setHarResult(parsed.result);
        harResultRef.current = parsed.result;
        const previousHarRawDataId = rawDataIdByTypeRef.current.har;
        if (useWorker && parsed.rawDataId && previousHarRawDataId && previousHarRawDataId !== parsed.rawDataId) {
          releaseRawDataId(previousHarRawDataId);
        }
        rememberRawData('har', parsed.rawData, parsed.rawDataId);

        if (resultRef.current) {
          setFileType('netlog');
          setActiveTab('conclusion');
          setActiveSubTab(undefined);
          window.location.hash = buildAppHash('netlog', 'conclusion');
          setHasData(true);
          finishLoad();
          message.success(`成功解析 ${parsed.result.totalRequests} 个 HAR 请求，已启用联合诊断`);
          return;
        }

        setFileType('har');
        setActiveTab('requests');
        setActiveSubTab(undefined);
        window.location.hash = buildAppHash('har', 'requests');
        setHasData(true);
        finishLoad();
        message.success(`成功解析 ${parsed.result.totalRequests} 个 HAR 请求`);
        return;
      }

      if (taskId < loadTaskIdRef.current && activeLoadCountRef.current > 1) {
        if (useWorker && parsed.rawDataId) {
          releaseRawDataId(parsed.rawDataId);
        }
        finishLoad();
        return;
      }
      setEvents(parsed.events);
      setResult(parsed.result);
      resultRef.current = parsed.result;
      const previousNetlogRawDataId = rawDataIdByTypeRef.current.netlog;
      if (useWorker && parsed.rawDataId && previousNetlogRawDataId && previousNetlogRawDataId !== parsed.rawDataId) {
        releaseRawDataId(previousNetlogRawDataId);
      }
      rememberRawData('netlog', parsed.rawData, parsed.rawDataId);

      if (harResultRef.current) {
        setFileType('netlog');
        setActiveTab('conclusion');
        setActiveSubTab(undefined);
        window.location.hash = buildAppHash('netlog', 'conclusion');
        setHasData(true);
        finishLoad();
        message.success(`成功解析 ${parsed.events.length} 个事件，已启用联合诊断`);
        return;
      }

      setFileType('netlog');
      setActiveTab('conclusion');
      setActiveSubTab(undefined);
      window.location.hash = buildAppHash('netlog', 'conclusion');
      setHasData(true);
      finishLoad();
      message.success(`成功解析 ${parsed.events.length} 个事件`);
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
    repairInfo?: HarAnalysisResult['repairInfo'],
    fileTypeHint?: 'netlog' | 'har' | 'log'
  ) => {
    activeLoadCountRef.current += 1;
    setLoading(true);
    setLoadingText('正在解析追加文件...');

    try {
      if ((isTextLog || fileTypeHint === 'log') && typeof data === 'string') {
        message.warning('追加 .log 文件不支持联合诊断，请上传 HAR 或 NetLog');
        finishLoad();
        return;
      }

      const parsed = await parseUploadedInput({
        data,
        isTextLog,
        repairInfo,
        fileTypeHint,
        useWorker,
        onProgress: (phase) => setLoadingText(phase),
      });

      if (parsed.kind === 'log') {
        message.warning('追加 .log 文件不支持联合诊断，请上传 HAR 或 NetLog');
        finishLoad();
        return;
      }

      if (parsed.kind === 'har') {
        setHarResult(parsed.result);
        harResultRef.current = parsed.result;
        const previousHarRawDataId = rawDataIdByTypeRef.current.har;
        if (useWorker && parsed.rawDataId && previousHarRawDataId && previousHarRawDataId !== parsed.rawDataId) {
          releaseRawDataId(previousHarRawDataId);
        }
        rememberRawData('har', parsed.rawData, parsed.rawDataId);

        if (resultRef.current) {
          setFileType('netlog');
          setActiveTab('conclusion');
          setActiveSubTab(undefined);
          window.location.hash = buildAppHash('netlog', 'conclusion');
          message.success(`追加 HAR 成功（${parsed.result.totalRequests} 请求），联合诊断已启用`);
        } else {
          setFileType('har');
          setActiveTab('requests');
          setActiveSubTab(undefined);
          window.location.hash = buildAppHash('har', 'requests');
          message.success(`追加 HAR 成功（${parsed.result.totalRequests} 请求）`);
        }

        setHasData(true);
        finishLoad();
        return;
      }

      setEvents(parsed.events);
      setResult(parsed.result);
      resultRef.current = parsed.result;
      const previousNetlogRawDataId = rawDataIdByTypeRef.current.netlog;
      if (useWorker && parsed.rawDataId && previousNetlogRawDataId && previousNetlogRawDataId !== parsed.rawDataId) {
        releaseRawDataId(previousNetlogRawDataId);
      }
      rememberRawData('netlog', parsed.rawData, parsed.rawDataId);

      if (harResultRef.current) {
        setFileType('netlog');
        setActiveTab('conclusion');
        setActiveSubTab(undefined);
        window.location.hash = buildAppHash('netlog', 'conclusion');
        message.success(`追加 NetLog 成功（${parsed.events.length} 事件），联合诊断已启用`);
      } else {
        setFileType('netlog');
        setActiveTab('conclusion');
        setActiveSubTab(undefined);
        window.location.hash = buildAppHash('netlog', 'conclusion');
        message.success(`追加 NetLog 成功（${parsed.events.length} 事件）`);
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
    setRawUploadDataByType({});
    setRawDataIdByType({});
    if (useWorker) {
      void releaseRawDataInWorker({ all: true });
    }
    activeLoadCountRef.current = 0;
    resultRef.current = null;
    harResultRef.current = null;
    setFileType('netlog');
    setActiveTab('conclusion');
    setActiveSubTab(undefined);
    setIpRoutingConclusions([]);
    window.location.hash = '';
  };

  const handleNetlogTabChange = (key: string) => {
    setActiveTab(key);
    const nextSubTab = key === 'expert' ? (activeSubTab || 'events') : undefined;
    setActiveSubTab(nextSubTab);
    window.location.hash = buildAppHash('netlog', key, nextSubTab);
  };



  const handleExport = () => {
    if (!result) return;
    const report = exportReport(result, { ipRoutingConclusions });
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
    {
      key: 'conclusion',
      label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MedicineBoxOutlined />结论与行动</span>,
      children: result ? (
        <ConclusionActionTab
          result={result}
          events={events}
          harResult={harResult}
          onUploadMissingFile={handleSecondaryFileLoaded}
          onNavigate={(tab, subTab) => {
            setActiveTab(tab);
            setActiveSubTab(subTab);
            window.location.hash = buildAppHash('netlog', tab, subTab);
          }}
        />
      ) : null,
    },
    { key: 'requests', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><GlobalOutlined />请求详情</span>, children: result ? <NetLogRequestList result={result} /> : null },
    {
      key: 'evidence',
      label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><RadarChartOutlined />证据链</span>,
      children: result ? (
        <EvidenceChainTab
          result={result}
          events={events}
          harResult={harResult}
          onUploadMissingFile={handleSecondaryFileLoaded}
          onLookupConclusionsChange={setIpRoutingConclusions}
        />
      ) : null,
    },
    {
      key: 'expert',
      label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><CodeOutlined />专家分析</span>,
      children: result ? (
        <ExpertAnalysisTab
          result={result}
          events={events}
          urlRequests={result.urlRequests}
          activeSubTab={activeSubTab}
          onSubTabChange={(subTab) => {
            setActiveSubTab(subTab);
            window.location.hash = buildAppHash('netlog', 'expert', subTab);
          }}
          onNavigateToSource={(sourceId) => {
            setActiveSubTab('events');
            window.location.hash = buildAppHash('netlog', 'expert', 'events');
            navigateTo({
              tab: 'expert',
              filters: { sourceId: String(sourceId) },
              source: '源链路',
              reason: '查看 source 事件',
            });
          }}
        />
      ) : null,
    },
    {
      key: 'raw',
      label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileSearchOutlined />原始数据</span>,
      children: (rawUploadDataByType.netlog || rawDataIdByType.netlog) ? (
        <Suspense fallback={<LazyFallback text="正在加载原始数据模块..." />}>
          <RawEvidenceExplorer rawData={rawUploadDataByType.netlog} rawDataId={rawDataIdByType.netlog} fileName="NetLog 原始数据" />
        </Suspense>
      ) : null,
    },
  ];

  const activeNetlogContent = tabItems.find(item => item.key === activeTab)?.children || tabItems[0].children;

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
            <Suspense fallback={<LazyFallback text="正在加载 HAR 页面..." />}>
              <HarResultPage
                result={harResult}
                rawData={rawUploadDataByType.har}
                rawDataId={rawDataIdByType.har}
                activeTab={activeTab}
                onTabChange={(key) => {
                  setActiveTab(key);
                  setActiveSubTab(undefined);
                  window.location.hash = buildAppHash('har', key);
                }}
              />
            </Suspense>
            {/* 追加 NetLog，进入 NetLog 结论与证据链 */}
            {!result && (
              <div style={{ marginTop: 24, padding: '20px 24px', background: 'var(--bg-surface)', borderRadius: 14, border: '1px dashed var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <RadarChartOutlined style={{ color: '#6366f1' }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>追加 NetLog，增强浏览器网络栈判断</span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  当前已加载 HAR。追加上传同一次问题复现导出的 NetLog 文件后，将自动进入 NetLog「结论与行动」，并可在「证据链」查看 HAR 与 NetLog 的关联证据。
                </p>
                <UploadZone onFileLoaded={handleSecondaryFileLoaded} compact />
              </div>
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
                  setActiveSubTab(undefined);
                  window.location.hash = buildAppHash('log', key);
                }}
              />
            </Suspense>
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
              const parsed = parseAppHash(buildAppHash('netlog', tab));
              const nextTab = parsed.tab || tab;
              const nextSubTab = parsed.subTab || (nextTab === 'expert' ? 'events' : undefined);
              setActiveTab(nextTab);
              setActiveSubTab(nextSubTab);
              window.location.hash = buildAppHash('netlog', nextTab, nextSubTab);
            }} />}
            <AnalysisDisclaimer variant="netlog" />
            <NetlogWorkbenchNav activeKey={activeTab} onChange={handleNetlogTabChange} />
            <div className="netlog-workbench-content">
              {activeNetlogContent}
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
