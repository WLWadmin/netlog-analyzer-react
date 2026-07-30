import { useState, useEffect, useRef, lazy, Suspense, useCallback, useMemo } from 'react';
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
  getNetlogAltSvcStateInWorker,
  getNetlogCacheStateInWorker,
  getNetlogDnsStateInWorker,
  getNetlogHttp2StateInWorker,
  getNetlogModulesStateInWorker,
  getNetlogPrerenderStateInWorker,
  getNetlogProxyStateInWorker,
  getNetlogQuicStateInWorker,
  getNetlogReportingStateInWorker,
  getNetlogSocketsStateInWorker,
  getNetlogStreamPoolStateInWorker,
  getNetlogTimelineStateInWorker,
  importNetlogDatasetInWorker,
  isWorkerSupported,
  largeNetlogTimeout,
  releaseNetlogDatasetInWorker,
  releaseRawDataInWorker,
} from './workers/workerClient';
import { unavailableNetlogDatasetState, type NetlogDatasetState } from './workers/netlogDatasetTypes';
import {
  parseUploadedInput,
  type UploadFileTypeHint,
  type UploadedParseResult,
} from './upload/parseUploadedInput';
import { useTheme } from './theme';
import { NavigationProvider, useNavigation } from './contexts/NavigationContext';
import UploadZone from './components/netlog/UploadZone';
import UploadEntry from './components/upload/UploadEntry';
import { cancelActiveTraceWorkerTask } from './workers/traceWorkerRegistry';
import { isTraceAnalysisEnabled } from './upload/traceUploadFeature';
import type { ParserMode } from './components/upload/ParserModeSelect';
import type { FileParserId } from './upload/fileFormatTypes';
import type { TraceContextResult } from './parsers/trace/types';
import {
  createExecutableFileFormatRegistry,
  createFileParseInput,
} from './upload/createFileFormatIntake';
import { useAnalysisIntake } from './upload/useAnalysisIntake';
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
import { buildNetlogExpertEvidencePackage } from './diagnosis/shared/netlogExpertEvidenceExport';

const { Header, Content } = Layout;

// 页面级懒加载：减少首包体积（重型模块拆分）
const HarResultPage = lazy(() => import('./components/har/HarResultPage'));
const LogResultPage = lazy(() => import('./components/log/LogResultPage'));
const TraceResultPage = lazy(() => import('./components/trace/TraceResultPage'));
const RawEvidenceExplorer = lazy(() => import('./components/raw/RawEvidenceExplorer'));
const DatasetRawEvidenceExplorer = lazy(() => import('./components/raw/DatasetRawEvidenceExplorer'));

const LazyFallback: React.FC<{ text?: string }> = ({ text = '正在加载模块...' }) => (
  <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
    {text}
  </div>
);

type UploadFlowEvent =
  | 'upload-flow:upload-start'
  | 'upload-flow:summary-ready'
  | 'upload-flow:dataset-auto-start'
  | 'upload-flow:dataset-progress'
  | 'upload-flow:dataset-ready'
  | 'upload-flow:dataset-error'
  | 'upload-flow:dataset-takeover';

interface UploadFlowState {
  uploadStartedAt?: number;
  summaryReadyAt?: number;
  datasetStartedAt?: number;
  eventsPreview?: number;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function safeErrorMessage(error: unknown): string {
  const messageText = error instanceof Error
    ? error.message
    : error !== null
      && typeof error === 'object'
      && 'message' in error
      && typeof error.message === 'string'
      ? error.message
      : String(error);
  return messageText.replace(/https?:\/\/\S+/g, '<URL>').slice(0, 240);
}

/** 各 fileType 合法的 tab key 集合 */
const VALID_TABS: Record<string, string[]> = {
  netlog: ['conclusion', 'requests', 'evidence', 'expert', 'raw'],
  har: ['requests', 'summary', 'raw-evidence'],
  log: ['overview', 'flows', 'performance', 'raw'],
  trace: ['overview'],
};

/** 内部组件：可以使用 useNavigation 监听 tab 切换 */
const AppContent: React.FC = () => {
  const [hasData, setHasData] = useState(false);
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [harResult, setHarResult] = useState<HarAnalysisResult | null>(null);
  const [logResult, setLogResult] = useState<LogAnalysisResult | null>(null);
  const [traceResult, setTraceResult] = useState<TraceContextResult | null>(null);
  const [rawUploadDataByType, setRawUploadDataByType] = useState<{ har?: unknown; netlog?: unknown; log?: unknown }>({});
  const [rawDataIdByType, setRawDataIdByType] = useState<{ har?: string; netlog?: string }>({});
  const [netlogDataset, setNetlogDataset] = useState<NetlogDatasetState>(unavailableNetlogDatasetState);
  const [currentNetlogFile, setCurrentNetlogFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<FileType>('netlog');
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('正在分析日志数据...');
  const [exportingExpertEvidence, setExportingExpertEvidence] = useState(false);
  const [showBackTop, setShowBackTop] = useState(false);
  const [activeTab, setActiveTab] = useState('conclusion');
  const [activeSubTab, setActiveSubTab] = useState<string | undefined>();
  const [ipRoutingConclusions, setIpRoutingConclusions] = useState<IpRoutingConclusion[]>([]);
  const [parserMode, setParserMode] = useState<ParserMode>('recommend');
  const { mode, toggleTheme } = useTheme();
  const { intent, navigateTo } = useNavigation();

  // Ref 用于避免连续多文件上传时的 state 异步判断问题
  const resultRef = useRef<AnalysisResult | null>(null);
  const harResultRef = useRef<HarAnalysisResult | null>(null);
  const rawDataIdByTypeRef = useRef(rawDataIdByType);
  const datasetIndexTaskIdRef = useRef(0);
  const datasetAnalysisIdRef = useRef<string | undefined>(undefined);
  const uploadFlowRef = useRef<UploadFlowState>({});
  const intakeTaskIdRef = useRef(0);
  const intakeFileRef = useRef<File | undefined>(undefined);
  const intakeProbeAbortRef = useRef<AbortController | undefined>(undefined);

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
        ? (intent.fileType as FileType)
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
  const mountedRef = useRef(true);
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

  const releaseDatasetAnalysisId = useCallback((analysisId?: string) => {
    if (!analysisId || !isWorkerSupported()) return;
    void releaseNetlogDatasetInWorker({ analysisId }).catch(() => {
      // Dataset 释放失败不影响当前浏览流程，reset/unload 仍会兜底释放全部 Dataset
    });
  }, []);

  const logUploadFlow = useCallback((event: UploadFlowEvent, details: Record<string, unknown> = {}) => {
    console.info('[netlog-upload-flow]', {
      event,
      ...details,
    });
  }, []);

  const startDatasetIndexingForFile = useCallback(async (
    file: File,
    options?: { background?: boolean; token?: number }
  ) => {
    if (!isWorkerSupported()) {
      if (!options?.background) message.warning('当前浏览器不支持 Worker Dataset 索引');
      return;
    }
    const token = options?.token ?? ++datasetIndexTaskIdRef.current;
    const previousAnalysisId = datasetAnalysisIdRef.current;
    const datasetStartedAt = nowMs();
    uploadFlowRef.current.datasetStartedAt = datasetStartedAt;
    if (options?.background) {
      logUploadFlow('upload-flow:dataset-auto-start', {
        datasetAutoStartDelayMs: uploadFlowRef.current.summaryReadyAt
          ? Math.round(datasetStartedAt - uploadFlowRef.current.summaryReadyAt)
          : undefined,
        datasetStatus: 'importing',
      });
    }
    if (!options?.background) {
      setLoading(true);
      setLoadingText('正在构建 NetLog Dataset 索引...');
    }
    setNetlogDataset({ status: 'importing', phase: '正在构建 NetLog Dataset 索引...', startedAt: Date.now(), updatedAt: Date.now() });
    try {
      const meta = await importNetlogDatasetInWorker(file, {
        onProgress: (phase) => {
          if (!options?.background && token === datasetIndexTaskIdRef.current) setLoadingText(phase);
          if (token === datasetIndexTaskIdRef.current) {
            setNetlogDataset(prev => ({
              ...prev,
              status: 'importing',
              phase,
              updatedAt: Date.now(),
            }));
            logUploadFlow('upload-flow:dataset-progress', {
              phase,
              datasetStatus: 'importing',
              elapsedMs: Math.round(nowMs() - datasetStartedAt),
            });
          }
        },
        timeout: largeNetlogTimeout(file.size),
      });
      if (token !== datasetIndexTaskIdRef.current) {
        releaseDatasetAnalysisId(meta.analysisId);
        return;
      }
      if (previousAnalysisId && previousAnalysisId !== meta.analysisId) {
        releaseDatasetAnalysisId(previousAnalysisId);
      }
      datasetAnalysisIdRef.current = meta.analysisId;
      const readyAt = nowMs();
      setNetlogDataset({
        status: 'ready',
        analysisId: meta.analysisId,
        eventCount: meta.eventCount,
        updatedAt: Date.now(),
      });
      logUploadFlow('upload-flow:dataset-ready', {
        analysisId: meta.analysisId,
        datasetStatus: 'ready',
        datasetEventCount: meta.eventCount,
        datasetImportMs: Math.round(readyAt - datasetStartedAt),
        datasetReadyMs: uploadFlowRef.current.uploadStartedAt
          ? Math.round(readyAt - uploadFlowRef.current.uploadStartedAt)
          : undefined,
      });
      logUploadFlow('upload-flow:dataset-takeover', {
        analysisId: meta.analysisId,
        datasetStatus: 'ready',
        datasetEventCount: meta.eventCount,
        activeExpertViews: ['events', 'data-loaded', 'timeline', 'dns', 'proxy', 'quic', 'http2', 'sockets', 'cache', 'alt-svc', 'stream-pool', 'reporting', 'modules', 'prerender', 'endpoint-evidence'],
      });
      if (!options?.background) {
        message.success(`Dataset 索引已就绪：${meta.eventCount ?? 0} 条事件`);
      } else {
        message.info(`Dataset 后台索引已就绪：${meta.eventCount ?? 0} 条事件`);
      }
    } catch (err) {
      if (token !== datasetIndexTaskIdRef.current) return;
      setNetlogDataset({
        status: 'error',
        error: safeErrorMessage(err),
        updatedAt: Date.now(),
      });
      logUploadFlow('upload-flow:dataset-error', {
        datasetStatus: 'error',
        datasetImportMs: Math.round(nowMs() - datasetStartedAt),
        error: safeErrorMessage(err),
      });
      if (!options?.background) {
        message.error('Dataset 索引失败: ' + (err as Error).message);
      }
    } finally {
      if (!options?.background && token === datasetIndexTaskIdRef.current) {
        setLoading(false);
      }
    }
  }, [logUploadFlow, releaseDatasetAnalysisId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadTaskIdRef.current += 1;
      intakeProbeAbortRef.current?.abort();
      cancelActiveTraceWorkerTask();
      if (isWorkerSupported()) {
        void releaseRawDataInWorker({ all: true }).catch(() => {
          // 页面卸载时释放失败不阻塞浏览器关闭流程
        });
        void releaseNetlogDatasetInWorker({ all: true }).catch(() => {
          // Dataset 释放失败不阻塞页面卸载
        });
      }
    };
  }, []);

  const isActiveLoad = (taskId: number) => (
    mountedRef.current && taskId === loadTaskIdRef.current
  );

  const finishLoad = (taskId: number) => {
    if (isActiveLoad(taskId)) setLoading(false);
  };

  // 追加上传：支持在已有数据基础上追加另一类型文件
  const handleSecondaryFileLoaded = async (
    data: unknown,
    isTextLog = false,
    repairInfo?: HarAnalysisResult['repairInfo'],
    fileTypeHint?: UploadFileTypeHint
  ) => {
    const taskId = ++loadTaskIdRef.current;
    setLoading(true);
    setLoadingText('正在解析追加文件...');
    if (data instanceof File && fileTypeHint === 'netlog') {
      uploadFlowRef.current = {
        uploadStartedAt: nowMs(),
      };
      logUploadFlow('upload-flow:upload-start', { datasetStatus: 'fallback' });
    }

    try {
      if ((isTextLog || fileTypeHint === 'log') && typeof data === 'string') {
        message.warning('追加 .log 文件不支持联合诊断，请上传 HAR 或 NetLog');
        finishLoad(taskId);
        return;
      }

      const parsed = await parseUploadedInput({
        data,
        isTextLog,
        repairInfo,
        fileTypeHint,
        useWorker,
        onProgress: (phase) => {
          if (isActiveLoad(taskId)) setLoadingText(phase);
        },
      });

      if (!isActiveLoad(taskId)) {
        if ('rawDataId' in parsed && useWorker && parsed.rawDataId) {
          releaseRawDataId(parsed.rawDataId);
        }
        return;
      }

      if (parsed.kind === 'log') {
        message.warning('追加 .log 文件不支持联合诊断，请上传 HAR 或 NetLog');
        finishLoad(taskId);
        return;
      }

      if (parsed.kind === 'trace') {
        message.warning('Trace 当前不参与 HAR/NetLog 联合诊断');
        finishLoad(taskId);
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
          setActiveTab('summary');
          setActiveSubTab(undefined);
          window.location.hash = buildAppHash('har', 'summary');
          message.success(`追加 HAR 成功（${parsed.result.totalRequests} 请求）`);
        }

        setHasData(true);
        finishLoad(taskId);
        return;
      }

      setEvents(parsed.events);
      setResult(parsed.result);
      if (data instanceof File && parsed.dataset?.status === 'fallback') {
        const summaryReadyAt = nowMs();
        uploadFlowRef.current.summaryReadyAt = summaryReadyAt;
        uploadFlowRef.current.eventsPreview = parsed.events.length;
        logUploadFlow('upload-flow:summary-ready', {
          datasetStatus: 'fallback',
          summaryScanMs: uploadFlowRef.current.uploadStartedAt
            ? Math.round(summaryReadyAt - uploadFlowRef.current.uploadStartedAt)
            : undefined,
          eventsPreview: parsed.events.length,
          datasetEventCount: parsed.result.largeFileMode?.parsedEvents,
        });
      }
      const previousDatasetAnalysisId = datasetAnalysisIdRef.current;
      if (previousDatasetAnalysisId) {
        releaseDatasetAnalysisId(previousDatasetAnalysisId);
        datasetAnalysisIdRef.current = undefined;
      }
      const datasetToken = ++datasetIndexTaskIdRef.current;
      setNetlogDataset(parsed.dataset || unavailableNetlogDatasetState);
      if (parsed.dataset?.status === 'ready' && parsed.dataset.analysisId) {
        datasetAnalysisIdRef.current = parsed.dataset.analysisId;
        logUploadFlow('upload-flow:dataset-ready', {
          analysisId: parsed.dataset.analysisId,
          datasetStatus: 'ready',
          datasetEventCount: parsed.dataset.eventCount,
          datasetImportMs: 0,
          datasetReadyMs: uploadFlowRef.current.uploadStartedAt
            ? Math.round(nowMs() - uploadFlowRef.current.uploadStartedAt)
            : undefined,
          singleScanDataset: true,
        });
        logUploadFlow('upload-flow:dataset-takeover', {
          analysisId: parsed.dataset.analysisId,
          datasetStatus: 'ready',
          datasetEventCount: parsed.dataset.eventCount,
          activeExpertViews: ['events', 'data-loaded', 'timeline', 'dns', 'proxy', 'quic', 'http2', 'sockets', 'cache', 'alt-svc', 'stream-pool', 'reporting', 'modules', 'prerender', 'endpoint-evidence'],
          singleScanDataset: true,
        });
      }
      setCurrentNetlogFile(data instanceof File ? data : null);
      resultRef.current = parsed.result;
      const previousNetlogRawDataId = rawDataIdByTypeRef.current.netlog;
      if (useWorker && parsed.rawDataId && previousNetlogRawDataId && previousNetlogRawDataId !== parsed.rawDataId) {
        releaseRawDataId(previousNetlogRawDataId);
      }
      rememberRawData('netlog', parsed.rawData, parsed.rawDataId);
      if (data instanceof File && useWorker && parsed.dataset?.status === 'fallback') {
        void startDatasetIndexingForFile(data, { background: true, token: datasetToken });
      }

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
      finishLoad(taskId);
    } catch (err) {
      if (!isActiveLoad(taskId)) return;
      finishLoad(taskId);
      if (
        err !== null
        && typeof err === 'object'
        && 'detail' in err
        && err.detail !== null
        && typeof err.detail === 'object'
        && 'code' in err.detail
        && err.detail.code === 'TRACE_CANCELLED'
      ) return;
      message.error('追加文件解析失败: ' + (err as Error).message);
    }
  };

  const intakeRegistry = useMemo(
    () => createExecutableFileFormatRegistry({ useWorker }),
    [useWorker],
  );

  const commitIntakeResult = useCallback(async (
    value: unknown,
    parserId: FileParserId,
  ) => {
    const parsed = value as UploadedParseResult;
    const expectedKind: Record<FileParserId, UploadedParseResult['kind']> = {
      'har@1': 'har',
      'chromium-netlog@1': 'netlog',
      'chromium-performance-trace@1': 'trace',
      'go-service-log@1': 'log',
    };
    if (parsed.kind !== expectedKind[parserId]) {
      throw new Error('解析器返回的数据类型与绑定结果不一致');
    }

    setIpRoutingConclusions([]);
    if (parsed.kind === 'trace') {
      setTraceResult(parsed.result);
      setFileType('trace');
      setActiveTab('overview');
      setActiveSubTab(undefined);
      setHasData(true);
      window.location.hash = buildAppHash('trace', 'overview');
      return;
    }

    if (parsed.kind === 'log') {
      setLogResult(parsed.result);
      setFileType('log');
      setActiveTab('overview');
      setActiveSubTab(undefined);
      setHasData(true);
      window.location.hash = buildAppHash('log', 'overview');
      message.success(`成功解析 ${parsed.result.stats.total} 条日志记录`);
      return;
    }

    if (parsed.kind === 'har') {
      setHarResult(parsed.result);
      harResultRef.current = parsed.result;
      const previousRawDataId = rawDataIdByTypeRef.current.har;
      if (
        useWorker
        && parsed.rawDataId
        && previousRawDataId
        && previousRawDataId !== parsed.rawDataId
      ) {
        releaseRawDataId(previousRawDataId);
      }
      rememberRawData('har', parsed.rawData, parsed.rawDataId);
      const joint = resultRef.current !== null;
      setFileType(joint ? 'netlog' : 'har');
      setActiveTab(joint ? 'conclusion' : 'summary');
      setActiveSubTab(undefined);
      setHasData(true);
      window.location.hash = buildAppHash(
        joint ? 'netlog' : 'har',
        joint ? 'conclusion' : 'summary',
      );
      message.success(
        joint
          ? `成功解析 ${parsed.result.totalRequests} 个 HAR 请求，已启用联合诊断`
          : `成功解析 ${parsed.result.totalRequests} 个 HAR 请求`,
      );
      return;
    }

    const sourceFile = intakeFileRef.current;
    uploadFlowRef.current = { uploadStartedAt: nowMs() };
    logUploadFlow('upload-flow:upload-start', {
      datasetStatus: parsed.dataset?.status ?? 'unavailable',
    });
    if (parsed.dataset?.status === 'fallback') {
      uploadFlowRef.current.summaryReadyAt = nowMs();
      uploadFlowRef.current.eventsPreview = parsed.events.length;
      logUploadFlow('upload-flow:summary-ready', {
        datasetStatus: 'fallback',
        eventsPreview: parsed.events.length,
        datasetEventCount: parsed.result.largeFileMode?.parsedEvents,
      });
    }
    setEvents(parsed.events);
    setResult(parsed.result);
    resultRef.current = parsed.result;
    setCurrentNetlogFile(sourceFile ?? null);
    const previousDatasetAnalysisId = datasetAnalysisIdRef.current;
    if (previousDatasetAnalysisId) {
      releaseDatasetAnalysisId(previousDatasetAnalysisId);
      datasetAnalysisIdRef.current = undefined;
    }
    const datasetToken = ++datasetIndexTaskIdRef.current;
    setNetlogDataset(parsed.dataset ?? unavailableNetlogDatasetState);
    if (parsed.dataset?.status === 'ready' && parsed.dataset.analysisId) {
      datasetAnalysisIdRef.current = parsed.dataset.analysisId;
      logUploadFlow('upload-flow:dataset-ready', {
        analysisId: parsed.dataset.analysisId,
        datasetStatus: 'ready',
        datasetEventCount: parsed.dataset.eventCount,
        singleScanDataset: true,
      });
      logUploadFlow('upload-flow:dataset-takeover', {
        analysisId: parsed.dataset.analysisId,
        datasetStatus: 'ready',
        datasetEventCount: parsed.dataset.eventCount,
        singleScanDataset: true,
      });
    }
    const previousRawDataId = rawDataIdByTypeRef.current.netlog;
    if (
      useWorker
      && parsed.rawDataId
      && previousRawDataId
      && previousRawDataId !== parsed.rawDataId
    ) {
      releaseRawDataId(previousRawDataId);
    }
    rememberRawData('netlog', parsed.rawData, parsed.rawDataId);
    if (
      sourceFile
      && useWorker
      && parsed.dataset?.status === 'fallback'
    ) {
      void startDatasetIndexingForFile(sourceFile, {
        background: true,
        token: datasetToken,
      });
    }
    setFileType('netlog');
    setActiveTab('conclusion');
    setActiveSubTab(undefined);
    setHasData(true);
    window.location.hash = buildAppHash('netlog', 'conclusion');
    message.success(
      harResultRef.current
        ? `成功解析 ${parsed.events.length} 个事件，已启用联合诊断`
        : `成功解析 ${parsed.events.length} 个事件`,
    );
  }, [
    logUploadFlow,
    releaseDatasetAnalysisId,
    releaseRawDataId,
    startDatasetIndexingForFile,
    useWorker,
  ]);

  const intake = useAnalysisIntake({
    registry: intakeRegistry,
    onResult: commitIntakeResult,
  });

  const handleIntakeFiles = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const taskId = `intake-${++intakeTaskIdRef.current}`;
    intakeProbeAbortRef.current?.abort();
    const probeAbortController = new AbortController();
    intakeProbeAbortRef.current = probeAbortController;
    intakeFileRef.current = file;
    intake.begin(taskId);
    try {
      const input = await createFileParseInput(file, taskId, {
        signal: probeAbortController.signal,
        onProgress: progress => intake.reportProgress(taskId, progress),
      });
      if (probeAbortController.signal.aborted) return;
      await intake.prepare(
        input,
        parserMode === 'recommend' ? undefined : parserMode,
      );
    } catch (error) {
      if (
        probeAbortController.signal.aborted
        || (error instanceof DOMException && error.name === 'AbortError')
      ) return;
      intake.fail(taskId, safeErrorMessage(error));
    } finally {
      if (intakeProbeAbortRef.current === probeAbortController) {
        intakeProbeAbortRef.current = undefined;
      }
    }
  }, [intake, parserMode]);

  const handleReset = () => {
    loadTaskIdRef.current += 1;
    intakeProbeAbortRef.current?.abort();
    intakeProbeAbortRef.current = undefined;
    cancelActiveTraceWorkerTask();
    intake.cancel();
    setHasData(false);
    setEvents([]);
    setResult(null);
    setHarResult(null);
    setLogResult(null);
    setTraceResult(null);
    setRawUploadDataByType({});
    setRawDataIdByType({});
    datasetIndexTaskIdRef.current += 1;
    datasetAnalysisIdRef.current = undefined;
    setNetlogDataset(unavailableNetlogDatasetState);
    setCurrentNetlogFile(null);
    if (useWorker) {
      void releaseRawDataInWorker({ all: true });
      void releaseNetlogDatasetInWorker({ all: true });
    }
    setLoading(false);
    resultRef.current = null;
    harResultRef.current = null;
    setFileType('netlog');
    setActiveTab('conclusion');
    setActiveSubTab(undefined);
    setIpRoutingConclusions([]);
    setParserMode('recommend');
    window.location.hash = '';
  };

  const handleNetlogTabChange = (key: string) => {
    setActiveTab(key);
    const nextSubTab = key === 'expert' ? (activeSubTab || 'events') : undefined;
    setActiveSubTab(nextSubTab);
    window.location.hash = buildAppHash('netlog', key, nextSubTab);
  };

  const handleStartDatasetIndexing = async () => {
    if (!currentNetlogFile) {
      message.warning('当前没有可用于 Dataset 索引的 NetLog 文件，请重新上传原始文件');
      return;
    }
    await startDatasetIndexingForFile(currentNetlogFile);
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

  const handleExportExpertEvidence = async () => {
    if (!result || exportingExpertEvidence) return;

    setExportingExpertEvidence(true);
    try {
      const analysisId = netlogDataset.status === 'ready' ? netlogDataset.analysisId : undefined;
      const datasetReady = Boolean(analysisId);
      const states = analysisId
        ? await Promise.all([
          getNetlogDnsStateInWorker({ analysisId }),
          getNetlogProxyStateInWorker({ analysisId }),
          getNetlogQuicStateInWorker({ analysisId }),
          getNetlogHttp2StateInWorker({ analysisId }),
          getNetlogSocketsStateInWorker({ analysisId }),
          getNetlogCacheStateInWorker({ analysisId }),
          getNetlogAltSvcStateInWorker({ analysisId }),
          getNetlogStreamPoolStateInWorker({ analysisId }),
          getNetlogReportingStateInWorker({ analysisId }),
          getNetlogTimelineStateInWorker({ analysisId }),
          getNetlogModulesStateInWorker({ analysisId }),
          getNetlogPrerenderStateInWorker({ analysisId }),
        ])
        : undefined;

      const report = buildNetlogExpertEvidencePackage({
        result,
        analysisId,
        datasetReady,
        dnsState: states?.[0],
        proxyState: states?.[1],
        quicState: states?.[2],
        http2State: states?.[3],
        socketsState: states?.[4],
        cacheState: states?.[5],
        altSvcState: states?.[6],
        streamPoolState: states?.[7],
        reportingState: states?.[8],
        timelineState: states?.[9],
        modulesState: states?.[10],
        prerenderState: states?.[11],
      });

      const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `netlog-expert-evidence-${Date.now()}.md`;
      a.click();
      URL.revokeObjectURL(url);

      if (datasetReady) {
        message.success('专家证据包已导出');
      } else {
        message.warning('Dataset 尚未就绪，已导出 summary-only 证据包');
      }
    } catch (error) {
      message.error(`专家证据包导出失败：${safeErrorMessage(error)}`);
    } finally {
      setExportingExpertEvidence(false);
    }
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
          dataset={netlogDataset}
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
          dataset={netlogDataset}
          canStartDatasetIndexing={Boolean(currentNetlogFile && useWorker)}
          onStartDatasetIndexing={handleStartDatasetIndexing}
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
          onNavigateToSourceChain={(sourceId) => {
            setActiveSubTab('events');
            window.location.hash = buildAppHash('netlog', 'expert', 'events');
            navigateTo({
              tab: 'expert',
              filters: { sourceChainId: String(sourceId) },
              source: '源链路',
              reason: '查看 source chain 事件',
            });
          }}
        />
      ) : null,
    },
    {
      key: 'raw',
      label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileSearchOutlined />原始事件 / 证据查询</span>,
      children: netlogDataset.status === 'ready' && netlogDataset.analysisId ? (
        <Suspense fallback={<LazyFallback text="正在加载 Dataset Raw Evidence..." />}>
          <DatasetRawEvidenceExplorer analysisId={netlogDataset.analysisId} fileName="NetLog Dataset Raw Evidence" />
        </Suspense>
      ) : result?.largeFileMode ? (
        <div style={{ padding: 24, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
          <h3 style={{ marginTop: 0, color: 'var(--text-primary)' }}>大文件摘要 fallback 已启用</h3>
          <p>
            已完整扫描文件并生成诊断摘要；当前首屏仅展示关键证据样本，未在主线程缓存完整 rawData。
            完整事件分页查询、Event detail、Data Loaded/DNS 状态视图和 Raw Evidence 虚拟树将在 Dataset 模式中提供。
          </p>
          <p>
            Dataset 状态：{netlogDataset.status === 'fallback' ? '摘要 fallback' : netlogDataset.status}
            {netlogDataset.error ? `（${netlogDataset.error}）` : ''}
          </p>
          <p style={{ marginBottom: 0 }}>
            已读取 {(result.largeFileMode.bytesRead / 1024 / 1024).toFixed(1)}MB，
            解析事件 {result.largeFileMode.parsedEvents.toLocaleString()} 条，
            跳过异常事件 {result.largeFileMode.skippedEvents.toLocaleString()} 条。
          </p>
        </div>
      ) : (rawUploadDataByType.netlog || rawDataIdByType.netlog) ? (
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
              浏览器诊断工作台
            </h1>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
              {isTraceAnalysisEnabled()
                ? '本地分析网络请求、页面性能与服务端日志'
                : '本地分析网络请求与服务端日志'}
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
                      { key: 'expert-evidence', label: exportingExpertEvidence ? '专家证据包生成中...' : '专家证据包', icon: <FileSearchOutlined />, onClick: handleExportExpertEvidence, disabled: exportingExpertEvidence },
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
          <div className="upload-page-shell">
            <UploadEntry
              traceEnabled={isTraceAnalysisEnabled()}
              state={intake.state}
              parserMode={parserMode}
              onParserModeChange={(nextMode) => {
                intake.cancel();
                setParserMode(nextMode);
              }}
              onFilesSelected={handleIntakeFiles}
              onConfirm={intake.confirm}
              onReset={intake.cancel}
              onCancel={() => {
                intakeProbeAbortRef.current?.abort();
                cancelActiveTraceWorkerTask();
                intake.cancel();
              }}
              onContinue={intake.continueToResult}
            />

            {/* 使用说明 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <QuestionCircleOutlined style={{ fontSize: 16, color: 'var(--accent-blue)' }} />
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>不知道如何获取文件？</span>
              </div>
              <div className="upload-guide-grid">
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
        ) : fileType === 'trace' && traceResult ? (
          <div style={{ padding: '24px 28px' }}>
            <Suspense fallback={<LazyFallback text="正在加载 Trace 页面..." />}>
              <TraceResultPage result={traceResult} />
            </Suspense>
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
            <NetlogWorkbenchNav activeKey={activeTab} onChange={handleNetlogTabChange} />
            <div className="netlog-workbench-content">
              {activeNetlogContent}
            </div>
            <AnalysisDisclaimer variant="netlog" title="分析边界" />
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
