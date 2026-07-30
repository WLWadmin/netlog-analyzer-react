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
