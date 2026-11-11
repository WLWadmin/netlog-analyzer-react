# 历史路由与实验开关基线

固定SHA：5d6f3f1da4931eeff13fb028d069862e8cb86530

以下完整摘录本轮核对的现有适配规则，所有已支持Hash保持兼容。新UI通过适配器转到矩阵对应阅读层，不能删除旧别名。空/未知处理继续原语义。实验开关逐层依赖不变，公开Trace入口另由traceUploadFeature控制。

## hashRouting完整规则

```typescript
export type FileType = 'netlog' | 'har' | 'log' | 'trace';

export const TRACE_TABS = [
  'conclusion',
  'overview',
  'network',
  'main-thread',
  'rendering',
  'interactions',
  'evidence',
] as const;

export type TraceTab = typeof TRACE_TABS[number];

export function resolveTraceTab(tab?: string): TraceTab {
  switch (tab) {
    case 'conclusion':
    case 'overview':
    case 'network':
    case 'main-thread':
    case 'rendering':
    case 'interactions':
    case 'evidence':
      return tab;
    default:
      return 'conclusion';
  }
}

export interface ParsedAppHash {
  fileType?: FileType;
  tab?: string;
  subTab?: string;
}

const LEGACY_NETLOG_TAB_MAP: Record<string, ParsedAppHash> = {
  overview: { fileType: 'netlog', tab: 'conclusion' },
  diagnosis: { fileType: 'netlog', tab: 'conclusion' },
  combined: { fileType: 'netlog', tab: 'evidence' },
  events: { fileType: 'netlog', tab: 'expert', subTab: 'events' },
  'source-chain': { fileType: 'netlog', tab: 'expert', subTab: 'source-chain' },
  'ssl-protocol': { fileType: 'netlog', tab: 'expert', subTab: 'security' },
  performance: { fileType: 'netlog', tab: 'expert', subTab: 'performance' },
  baseline: { fileType: 'netlog', tab: 'expert', subTab: 'baseline' },
  'raw-evidence': { fileType: 'netlog', tab: 'raw' },
};

const LEGACY_HAR_TAB_MAP: Record<string, ParsedAppHash> = {
  diagnosis: { fileType: 'har', tab: 'summary' },
};

export function parseAppHash(hash: string): ParsedAppHash {
  const clean = hash.replace(/^#/, '').trim();
  if (!clean) return {};

  const [first, second, third] = clean.split('/');

  if (first === 'netlog') {
    if (second && LEGACY_NETLOG_TAB_MAP[second]) {
      return LEGACY_NETLOG_TAB_MAP[second];
    }
    return { fileType: 'netlog', tab: second, subTab: third };
  }

  if (first === 'har') {
    if (second && LEGACY_HAR_TAB_MAP[second]) {
      return LEGACY_HAR_TAB_MAP[second];
    }
    return { fileType: 'har', tab: second };
  }

  if (first === 'log') {
    return { fileType: 'log', tab: second };
  }

  if (first === 'trace') {
    return { fileType: 'trace', tab: resolveTraceTab(second) };
  }

  if (LEGACY_NETLOG_TAB_MAP[first]) {
    return LEGACY_NETLOG_TAB_MAP[first];
  }

  return { tab: first, subTab: second };
}

export function buildAppHash(fileType: FileType, tab: string, subTab?: string): string {
  return `#${[fileType, tab, subTab].filter(Boolean).join('/')}`;
}

```

## featureFlag完整规则

```typescript
export function isTraceWorkbenchEnabled(): boolean {
  return process.env.REACT_APP_ENABLE_TRACE_WORKBENCH === '1';
}

export function isTraceTimelineEnabled(): boolean {
  return isTraceWorkbenchEnabled()
    && process.env.REACT_APP_ENABLE_TRACE_TIMELINE === '1';
}

export function isTraceExpertAnalysisEnabled(): boolean {
  return isTraceTimelineEnabled()
    && process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS === '1';
}

export function isTraceCrossSourceEnabled(): boolean {
  return isTraceExpertAnalysisEnabled()
    && process.env.REACT_APP_ENABLE_TRACE_CROSS_SOURCE === '1';
}

export function isTraceStage5Enabled(): boolean {
  return isTraceCrossSourceEnabled()
    && process.env.REACT_APP_ENABLE_TRACE_STAGE5 === '1';
}

export function isTraceStage6Enabled(): boolean {
  return isTraceStage5Enabled()
    && process.env.REACT_APP_ENABLE_TRACE_STAGE6 === '1';
}

```

## 公开Trace上传开关

```typescript
const BASE_ACCEPT = '.json,.har,.log';
const TRACE_ACCEPT = '.trace,.json2,.json.gz,.trace.gz,.json2.gz';
const BASE_UPLOAD_EXTENSIONS = ['.json', '.har', '.log'];
const TRACE_UPLOAD_EXTENSIONS = [
  '.trace',
  '.json2',
  '.json.gz',
  '.trace.gz',
  '.json2.gz',
];

export function isTraceAnalysisEnabled(): boolean {
  return process.env.REACT_APP_ENABLE_TRACE_ANALYSIS !== '0';
}

export function uploadAccept(): string {
  return isTraceAnalysisEnabled()
    ? `${BASE_ACCEPT},${TRACE_ACCEPT}`
    : BASE_ACCEPT;
}

export function isSupportedUploadName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  const extensions = isTraceAnalysisEnabled()
    ? [...BASE_UPLOAD_EXTENSIONS, ...TRACE_UPLOAD_EXTENSIONS]
    : BASE_UPLOAD_EXTENSIONS;
  return extensions.some(extension => lower.endsWith(extension));
}

```
