/**
 * 统一证据跳转规则
 * 页面组件不再根据 title/icon 自行推断跳转规则，全部收口到这里
 */

import type { DiagnosticNavigationTarget, DiagnosticCategory } from './types';

export function buildHarNavigationTarget(
  category: DiagnosticCategory,
  opts?: {
    requestIds?: number[];
    keyword?: string;
    errorCode?: string;
  }
): DiagnosticNavigationTarget {
  const base: DiagnosticNavigationTarget = {
    tab: 'requests',
    requestIds: opts?.requestIds,
  };

  switch (category) {
    case 'dns':
      return { ...base, tab: 'requests', keyword: opts?.keyword, errorOnly: true };
    case 'connect':
      return { ...base, tab: 'requests', keyword: opts?.keyword, errorOnly: true };
    case 'tls':
      return { ...base, tab: 'requests', keyword: 'SSL', errorOnly: true };
    case 'server':
      return { ...base, tab: 'requests', keyword: opts?.keyword, errorCode: opts?.errorCode };
    case 'performance':
      return { ...base, tab: 'requests', errorOnly: true };
    case 'cors':
      return { ...base, tab: 'requests', keyword: 'CORS', errorOnly: true };
    case 'security':
      return { ...base, tab: 'requests', keyword: opts?.keyword };
    case 'cache':
      return { ...base, tab: 'requests', keyword: opts?.keyword };
    case 'compression':
      return { ...base, tab: 'requests', keyword: opts?.keyword };
    case 'redirect':
      return { ...base, tab: 'requests', keyword: '3', errorOnly: true };
    default:
      return base;
  }
}

export function buildNetlogNavigationTarget(
  category: DiagnosticCategory,
  opts?: {
    eventIds?: string[];
    keyword?: string;
    errorCode?: string;
  }
): DiagnosticNavigationTarget {
  const base: DiagnosticNavigationTarget = {
    tab: 'events',
    eventIds: opts?.eventIds,
  };

  switch (category) {
    case 'dns':
      return { ...base, tab: 'events', keyword: 'DNS', errorOnly: true };
    case 'proxy':
      return { ...base, tab: 'events', keyword: 'PROXY', errorOnly: true };
    case 'tls':
      return { ...base, tab: 'events', keyword: 'SSL', errorOnly: true };
    case 'connect':
      return { ...base, tab: 'events', errorCode: opts?.errorCode, errorOnly: true };
    case 'protocol':
      return { ...base, tab: 'protocol', keyword: opts?.keyword };
    default:
      return base;
  }
}
