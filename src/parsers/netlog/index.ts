// src/parsers/netlog/index.ts — 统一导出

export {
  parseLog,
  percentile,
} from './parser';

export type {
  ParsedEvent,
  URLRequest,
  RequestTimeline,
  PhaseInfo,
  ProxyInfo,
  SslIssue,
  FailedDomain,
  DiagnosisIssue,
  AnalysisResult,
} from './parser';

export {
  generateSuggestions,
  generateNextStepInfo,
  generateChecklist,
  exportReport,
} from './diagnosis';

export type {
  Suggestion,
  NextStepInfo,
  CheckItem,
} from './diagnosis';

export {
  EVENT_TYPES,
  SOURCE_TYPES,
  PHASE,
  getNetErrorDescription,
  isHttp2Goaway,
  isHttp2GoawayRecv,
  isHttp2GoawaySend,
} from './constants';

export {
  classifyNetError,
  classifySslIssueCategory,
} from './errorClassifier';

export type {
  NetErrorCategory,
  NetErrorCategoryName,
} from './errorClassifier';
