import type { HarRequestEntry } from '../../harParser';
import type { URLRequest } from '../../parsers/netlog/parser';

export type RequestImportanceLevel = 'high' | 'medium' | 'low';

export interface RequestImportance {
  level: RequestImportanceLevel;
  score: number;
  reasons: string[];
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function methodScore(method: string | undefined): { score: number; reason?: string } {
  const normalized = (method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalized)) {
    return { score: 28, reason: `${normalized} 通常是用户操作或业务写请求` };
  }
  return { score: 0 };
}

function pathBusinessScore(path: string): { score: number; reason?: string } {
  if (/(\/api\/|\/graphql|\/rpc|\/ajax|\/v\d+\/|\/login|\/auth|\/order|\/checkout|\/pay|\/submit|\/upload)/i.test(path)) {
    return { score: 24, reason: 'pathname 命中业务接口特征' };
  }
  if (/(?:^|\/)(?:analytics|collect|beacon|track|telemetry|metrics|logs?|sentry)(?:\/|$)/i.test(path)) {
    return { score: -30, reason: 'pathname 命中埋点/遥测特征' };
  }
  return { score: 0 };
}

export function getHarRequestImportance(entry: HarRequestEntry): RequestImportance {
  let score = 20;
  const reasons: string[] = [];

  if (entry.category === 'doc' || entry.rawType === 'document') {
    score += 45;
    reasons.push('document 主文档请求');
  }
  if (['xhr', 'fetch'].includes(entry.category) || ['xhr', 'fetch'].includes(entry.rawType)) {
    score += 35;
    reasons.push('XHR/fetch 业务请求');
  }
  if (['js', 'css', 'font'].includes(entry.category)) {
    score += 15;
    reasons.push('关键静态依赖资源');
  }
  if (['img', 'media'].includes(entry.category)) {
    score -= 20;
    reasons.push('图片/媒体资源默认低于业务请求');
  }

  const method = methodScore(entry.method);
  score += method.score;
  if (method.reason) reasons.push(method.reason);

  const path = pathBusinessScore(safePath(entry.url));
  score += path.score;
  if (path.reason) reasons.push(path.reason);

  const finalScore = Math.max(0, Math.min(100, score));
  return {
    level: finalScore >= 65 ? 'high' : finalScore >= 35 ? 'medium' : 'low',
    score: finalScore,
    reasons: reasons.length ? reasons : ['未命中高价值业务特征'],
  };
}

export function getNetlogRequestImportance(request: URLRequest): RequestImportance {
  let score = 20;
  const reasons: string[] = [];
  const method = methodScore(request.method);
  score += method.score;
  if (method.reason) reasons.push(method.reason);

  const path = pathBusinessScore(safePath(request.url));
  score += path.score;
  if (path.reason) reasons.push(path.reason);

  const resourceText = [request.protocol, request.status].filter(Boolean).join(' ').toLowerCase();
  if (/document|html/.test(resourceText)) {
    score += 35;
    reasons.push('NetLog 请求像主文档/HTML');
  }
  if (/javascript|css|font/.test(resourceText)) {
    score += 12;
    reasons.push('NetLog 请求像关键静态依赖');
  }

  const finalScore = Math.max(0, Math.min(100, score));
  return {
    level: finalScore >= 65 ? 'high' : finalScore >= 35 ? 'medium' : 'low',
    score: finalScore,
    reasons: reasons.length ? reasons : ['未命中高价值业务特征'],
  };
}

export function summarizeRequestImportance(importances: RequestImportance[]): { maxScore: number; highCount: number; mediumCount: number; lowCount: number; reasonSummary: string[] } {
  return {
    maxScore: importances.length ? Math.max(...importances.map(item => item.score)) : 0,
    highCount: importances.filter(item => item.level === 'high').length,
    mediumCount: importances.filter(item => item.level === 'medium').length,
    lowCount: importances.filter(item => item.level === 'low').length,
    reasonSummary: Array.from(new Set(importances.flatMap(item => item.reasons))).slice(0, 5),
  };
}
