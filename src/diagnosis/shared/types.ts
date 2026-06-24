/**
 * 统一诊断模型类型定义
 * 用于 HAR、NetLog、联合诊断的标准化输出
 */

export type DiagnosticSource = 'har' | 'netlog' | 'combined';

export type DiagnosticCategory =
  | 'dns'
  | 'proxy'
  | 'tls'
  | 'connect'
  | 'protocol'
  | 'server'
  | 'client'
  | 'performance'
  | 'cache'
  | 'compression'
  | 'security'
  | 'cors'
  | 'redirect'
  | 'network-change'
  | 'browser-queue'
  | 'quality'
  | 'unknown';

export type DiagnosticRole = 'user' | 'it' | 'backend' | 'frontend';

export type DiagnosticScopeType =
  | 'single-request'
  | 'single-domain'
  | 'multi-domain'
  | 'global'
  | 'https-only'
  | 'quic-only'
  | 'server-side'
  | 'client-side'
  | 'unknown';

export interface DiagnosticScope {
  type: DiagnosticScopeType;
  summary: string;
  affectedRequestCount?: number;
  affectedDomainCount?: number;
}

export interface DiagnosticEvidence {
  label: string;
  value: string;
  source: 'har' | 'netlog' | 'derived';
  fieldPath?: string;
  requestIds?: number[];
  eventIds?: string[];
  detail?: string;
  /** 联合诊断：该证据来自哪个原始 source（用于双源融合时区分） */
  originalSource?: 'har' | 'netlog';
  /** 联合诊断：与另一源的证据是否冲突 */
  conflictWith?: string;
}

export interface DiagnosticAction {
  role: DiagnosticRole;
  title: string;
  detail: string;
  command?: string;
  platform?: 'windows' | 'macos' | 'linux' | 'all';
  expectedResult?: string;
  nextIfFailed?: string;
}

export interface DiagnosticNavigationTarget {
  tab: 'overview' | 'requests' | 'performance' | 'ssl' | 'protocol' | 'diagnosis' | 'events';
  keyword?: string;
  errorCode?: string;
  errorOnly?: boolean;
  requestIds?: number[];
  eventIds?: string[];
}

export interface DiagnosticCard {
  id: string;
  source: DiagnosticSource;
  category: DiagnosticCategory;
  severity: 'critical' | 'warning' | 'info';
  confidence: 'high' | 'medium' | 'low';
  title: string;
  conclusion: string;
  scope: DiagnosticScope;
  evidence: DiagnosticEvidence[];
  actions: DiagnosticAction[];
  limitations?: string[];
  relatedRequestIds?: number[];
  relatedEventIds?: string[];
  navigationTarget?: DiagnosticNavigationTarget;
  /** 联合诊断：该卡片融合了哪些原始 source 的证据 */
  mergedSources?: ('har' | 'netlog')[];
  /** 联合诊断：融合时发现的证据冲突提示 */
  conflictNotes?: string[];
}

/** 采集质量检查结果 */
export interface CollectionQuality {
  source: DiagnosticSource;
  isDiagnosable: boolean;
  issues: {
    type: 'missing_field' | 'insufficient_data' | 'suspicious_pattern';
    severity: 'warning' | 'info';
    message: string;
    detail?: string;
  }[];
  missingFields?: string[];
  recommendations?: string[];
}

/** 诊断结果汇总 */
export interface DiagnosisSummary {
  cards: DiagnosticCard[];
  quality: CollectionQuality;
  overallSeverity: 'critical' | 'warning' | 'info';
  healthScore?: number;
  /** 联合诊断：双源融合后的联合置信度 */
  combinedConfidence?: 'high' | 'medium' | 'low';
  /** 联合诊断：融合过程中发现的冲突摘要 */
  fusionConflicts?: string[];
}
