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
}
