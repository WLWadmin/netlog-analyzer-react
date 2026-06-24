/**
 * HAR 诊断结果 → DiagnosticCard 适配层
 * 将 harDiagnosis.ts 的输出转换为统一 DiagnosticCard 结构
 */

import type { HarAnalysisResult, HarRequestEntry } from '../../harParser';
import type { HarDiagnosisResult, AttributionItem, NetworkPhaseStatus } from '../../harDiagnosis';
import type {
  DiagnosticCard,
  DiagnosticCategory,
  DiagnosticEvidence,
  DiagnosticAction,
  DiagnosticScope,
  CollectionQuality,
  DiagnosisSummary,
} from './types';
import {
  HAR_DIAG_THRESHOLDS,
  HAR_EVIDENCE_THRESHOLDS,
  HAR_SEVERITY_THRESHOLDS,
} from './harThresholds';

// ========== 工具函数 ==========

function generateId(prefix: string, index: number): string {
  return `${prefix}-${index}-${Date.now().toString(36)}`;
}

function mapAttributionTypeToCategory(type: AttributionItem['type']): DiagnosticCategory {
  const map: Record<AttributionItem['type'], DiagnosticCategory> = {
    client: 'browser-queue',
    network: 'connect',
    server: 'server',
    cdn: 'cache',
    dns: 'dns',
  };
  return map[type] || 'unknown';
}

function mapSeverity(severity: 'healthy' | 'warning' | 'critical'): DiagnosticCard['severity'] {
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'warning';
  return 'info';
}

function buildScope(
  affectedCount: number,
  domainCount?: number,
  type?: DiagnosticScope['type']
): DiagnosticScope {
  if (affectedCount === 1) {
    return { type: type || 'single-request', summary: '影响 1 个请求', affectedRequestCount: 1 };
  }
  if (domainCount && domainCount > 1) {
    return {
      type: type || 'multi-domain',
      summary: `影响 ${affectedCount} 个请求，涉及 ${domainCount} 个域名`,
      affectedRequestCount: affectedCount,
      affectedDomainCount: domainCount,
    };
  }
  return {
    type: type || 'global',
    summary: `影响 ${affectedCount} 个请求`,
    affectedRequestCount: affectedCount,
  };
}

// ========== 证据构建 ==========

function buildPhaseEvidence(phase: NetworkPhaseStatus): DiagnosticEvidence[] {
  const evidence: DiagnosticEvidence[] = [
    {
      label: '平均耗时',
      value: `${phase.avgMs} ms`,
      source: 'har',
    },
    {
      label: 'P95 耗时',
      value: `${phase.p95Ms} ms`,
      source: 'har',
    },
    {
      label: '最大耗时',
      value: `${phase.maxMs} ms`,
      source: 'har',
    },
  ];
  if (phase.slowCount > 0) {
    evidence.push({
      label: '慢请求数量',
      value: `${phase.slowCount} 个`,
      source: 'derived',
    });
  }
  if (phase.slowDomains.length > 0) {
    evidence.push({
      label: '涉及域名',
      value: phase.slowDomains.join('、'),
      source: 'derived',
    });
  }
  return evidence;
}

function buildAttributionEvidence(attr: AttributionItem, entries: HarRequestEntry[]): DiagnosticEvidence[] {
  const evidence: DiagnosticEvidence[] = [];

  // 从 evidence 数组构建
  if (attr.evidence && attr.evidence.length > 0) {
    attr.evidence.forEach((e, i) => {
      evidence.push({
        label: i === 0 ? '关键证据' : `证据 ${i + 1}`,
        value: e,
        source: 'har',
      });
    });
  }

  // 查找相关请求 ID（使用集中阈值配置）
  const { attributionServerWait, attributionDns, attributionNetworkDns, attributionNetworkConnect, attributionClientBlocked, maxRelatedRequestsPerAttr } = HAR_EVIDENCE_THRESHOLDS;
  const relatedIds = entries
    .filter(e => {
      if (attr.type === 'server') return e.timings.wait > attributionServerWait;
      if (attr.type === 'dns') return e.timings.dns > attributionDns;
      if (attr.type === 'network') return e.timings.dns > attributionNetworkDns || e.timings.connect > attributionNetworkConnect;
      if (attr.type === 'client') return e.timings.blocked > attributionClientBlocked;
      return false;
    })
    .map(e => e.id)
    .slice(0, maxRelatedRequestsPerAttr);

  if (relatedIds.length > 0) {
    evidence.push({
      label: '相关请求',
      value: `${relatedIds.length} 个请求`,
      source: 'har',
      requestIds: relatedIds,
    });
  }

  return evidence;
}

// ========== Action 构建 ==========

function buildAttributionActions(attr: AttributionItem): DiagnosticAction[] {
  const actions: DiagnosticAction[] = [];

  switch (attr.type) {
    case 'server':
      actions.push(
        {
          role: 'user',
          title: '记录异常信息',
          detail: '记录异常 URL、时间、以及响应头中的 x-tt-logid（如有）',
        },
        {
          role: 'backend',
          title: '查询服务端日志',
          detail: '根据 x-tt-logid 查询服务端日志，检查数据库、缓存、下游依赖耗时',
        },
        {
          role: 'user',
          title: '切换网络验证',
          detail: '切换手机热点或其他网络，验证是否仍然慢',
        }
      );
      break;
    case 'dns':
      actions.push(
        {
          role: 'user',
          title: '更换 DNS 测试',
          detail: '国内用户修改 DNS 为 223.5.5.5 或 119.29.29.29；海外用户修改为 8.8.8.8 或 1.1.1.1',
          command: 'nslookup example.com 223.5.5.5',
          platform: 'all',
          expectedResult: '应返回正确的 IP 地址',
        },
        {
          role: 'user',
          title: '清除 DNS 缓存',
          detail: '清除系统和浏览器 DNS 缓存后重试',
          command: 'macOS: dscacheutil -flushcache; Windows: ipconfig /flushdns',
          platform: 'all',
        },
        {
          role: 'it',
          title: '检查企业 DNS 配置',
          detail: '检查企业 DNS / PAC / 防火墙策略是否影响域名解析',
        }
      );
      break;
    case 'network':
      actions.push(
        {
          role: 'user',
          title: '检查网络连通性',
          detail: '使用 ping 测试到目标域名的连通性和延迟',
          command: 'ping example.com -n 20',
          platform: 'all',
          expectedResult: '丢包率应 < 5%，延迟应 < 200ms',
        },
        {
          role: 'user',
          title: '切换网络对比',
          detail: '切换手机热点验证是否为当前网络环境问题',
        },
        {
          role: 'it',
          title: '排查网络链路',
          detail: '检查企业网络策略、防火墙、代理配置',
        }
      );
      break;
    case 'client':
      actions.push(
        {
          role: 'user',
          title: '减少并发请求',
          detail: '检查页面是否同时发起过多请求，优化请求调度',
        },
        {
          role: 'frontend',
          title: '优化资源加载策略',
          detail: '使用资源预加载、懒加载、合并请求等策略减少浏览器排队',
        }
      );
      break;
    case 'cdn':
      actions.push(
        {
          role: 'backend',
          title: '检查 CDN 节点状态',
          detail: '排查 CDN 节点健康度，检查是否有节点异常',
        },
        {
          role: 'it',
          title: '确认 CDN 配置',
          detail: '检查 CDN 缓存策略、回源配置是否正确',
        }
      );
      break;
  }

  return actions;
}

// ========== 主转换函数 ==========

export function harDiagnosisToCards(
  harResult: HarAnalysisResult,
  diagnosis: HarDiagnosisResult
): DiagnosticCard[] {
  const cards: DiagnosticCard[] = [];
  const entries = harResult.entries;

  // 1. 整体健康状态卡片
  if (diagnosis.overallStatus !== 'healthy') {
    cards.push({
      id: generateId('har-overview', 0),
      source: 'har',
      category: 'quality',
      severity: mapSeverity(diagnosis.overallStatus),
      confidence: diagnosis.overallStatus === 'critical' ? 'high' : 'medium',
      title: diagnosis.overallStatus === 'critical' ? '检测到严重网络问题' : '检测到网络异常',
      conclusion: diagnosis.summary,
      scope: buildScope(diagnosis.totalRequests, diagnosis.domainCount, 'global'),
      evidence: diagnosis.findings.map(f => ({
        label: '发现',
        value: f,
        source: 'derived',
      })),
      actions: [
        {
          role: 'user',
          title: '查看详细诊断',
          detail: '浏览下方的诊断卡片，按优先级逐一排查',
        },
      ],
      limitations: [
        'HAR 文件不包含浏览器网络栈底层事件，部分问题需要补充 NetLog 验证',
        '健康评分仅作为辅助参考，具体以诊断卡片为准',
      ],
    });
  }

  // 2. 网络阶段问题卡片
  diagnosis.networkStatus.forEach((phase, idx) => {
    if (phase.status === 'healthy') return;

    const categoryMap: Record<string, DiagnosticCategory> = {
      'DNS': 'dns',
      'TCP': 'connect',
      'TLS': 'tls',
      'TTFB': 'server',
      '下载': 'performance',
    };

    cards.push({
      id: generateId('har-phase', idx),
      source: 'har',
      category: categoryMap[phase.label] || 'performance',
      severity: mapSeverity(phase.status),
      confidence: phase.status === 'critical' ? 'high' : 'medium',
      title: `${phase.label}阶段${phase.status === 'critical' ? '严重' : ''}偏高`,
      conclusion: `${phase.label}阶段平均 ${phase.avgMs}ms，P95 ${phase.p95Ms}ms，${phase.slowCount} 个请求超过阈值`,
      scope: buildScope(phase.slowCount, phase.slowDomains.length, phase.slowDomains.length > 1 ? 'multi-domain' : 'global'),
      evidence: buildPhaseEvidence(phase),
      actions: [
        {
          role: 'user',
          title: `排查${phase.label}问题`,
          detail: phase.detail,
        },
      ],
      relatedRequestIds: entries
        .filter(e => {
          const t = e.timings;
          const { dnsSlow, connectSlow, sslSlow, ttfbSlow, receiveSlow } = HAR_DIAG_THRESHOLDS;
          if (phase.label === 'DNS') return t.dns > dnsSlow;
          if (phase.label === 'TCP') return t.connect > connectSlow;
          if (phase.label === 'TLS') return t.ssl > sslSlow;
          if (phase.label === 'TTFB') return t.wait > ttfbSlow;
          if (phase.label === '下载') return t.receive > receiveSlow;
          return false;
        })
        .map(e => e.id)
        .slice(0, HAR_EVIDENCE_THRESHOLDS.maxRelatedRequestsPerPhase),
    });
  });

  // 3. HTTP 状态异常卡片
  if (diagnosis.httpStatus.countFailed > 0) {
    const evidence: DiagnosticEvidence[] = [
      { label: '失败请求数', value: `${diagnosis.httpStatus.countFailed} 个`, source: 'har' },
      { label: '5xx 错误', value: `${diagnosis.httpStatus.count5xx} 个`, source: 'har' },
      { label: '4xx 错误', value: `${diagnosis.httpStatus.count4xx} 个`, source: 'har' },
      { label: '状态为 0', value: `${diagnosis.httpStatus.count0} 个`, source: 'har' },
    ];

    const actions: DiagnosticAction[] = [];

    if (diagnosis.httpStatus.count5xx > 0) {
      actions.push({
        role: 'backend',
        title: '排查服务端错误',
        detail: `${diagnosis.httpStatus.count5xx} 个 5xx 错误，建议检查服务端日志和接口稳定性`,
      });
    }
    if (diagnosis.httpStatus.count4xx > 0) {
      actions.push({
        role: 'frontend',
        title: '检查请求参数',
        detail: `${diagnosis.httpStatus.count4xx} 个 4xx 错误，检查请求路径、参数、鉴权信息`,
      });
    }
    if (diagnosis.httpStatus.count0 > 0) {
      actions.push(
        {
          role: 'user',
          title: '补充 NetLog 验证',
          detail: `${diagnosis.httpStatus.count0} 个请求状态为 0，HAR 无法直接获取 NetError，建议补充 NetLog 文件定位根因`,
        },
        {
          role: 'user',
          title: '检查 CORS / 安全策略',
          detail: 'status = 0 可能是 CORS 预检失败、浏览器取消、Mixed Content 或安全策略拦截',
        }
      );
    }

    cards.push({
      id: generateId('har-http', 0),
      source: 'har',
      category: diagnosis.httpStatus.count5xx > 0 ? 'server' : 'security',
      severity: diagnosis.httpStatus.count5xx > 0 ? 'critical' : 'warning',
      confidence: 'high',
      title: `HTTP 异常请求 (${diagnosis.httpStatus.countFailed} 个)`,
      conclusion: diagnosis.httpStatus.count5xx > 0
        ? `检测到 ${diagnosis.httpStatus.count5xx} 个服务端错误 (5xx)，建议优先排查后端`
        : `检测到 ${diagnosis.httpStatus.countFailed} 个异常请求，需进一步分析`,
      scope: buildScope(diagnosis.httpStatus.countFailed, undefined, 'global'),
      evidence,
      actions,
      relatedRequestIds: entries.filter(e => e.isFailed).map(e => e.id).slice(0, 10),
      limitations: diagnosis.httpStatus.count0 > 0
        ? ['status = 0 的精确根因需要 NetLog 验证']
        : undefined,
    });
  }

  // 4. 问题归因卡片
  diagnosis.attributions.forEach((attr, idx) => {
    cards.push({
      id: generateId('har-attr', idx),
      source: 'har',
      category: mapAttributionTypeToCategory(attr.type),
      severity: mapSeverity(attr.severity),
      confidence: attr.priority === 0 ? 'high' : 'medium',
      title: attr.title,
      conclusion: attr.description,
      scope: buildScope(
        entries.filter(e => {
          const { attributionServerWait, attributionDns, attributionNetworkDns, attributionNetworkConnect, attributionClientBlocked } = HAR_EVIDENCE_THRESHOLDS;
          if (attr.type === 'server') return e.timings.wait > attributionServerWait;
          if (attr.type === 'dns') return e.timings.dns > attributionDns;
          if (attr.type === 'network') return e.timings.dns > attributionNetworkDns || e.timings.connect > attributionNetworkConnect;
          if (attr.type === 'client') return e.timings.blocked > attributionClientBlocked;
          return false;
        }).length,
        undefined,
        'global'
      ),
      evidence: buildAttributionEvidence(attr, entries),
      actions: buildAttributionActions(attr),
      limitations: [
        'HAR 单文件结论默认最高中置信度；只有明确 HTTP 状态码、多个请求一致时才可高置信度',
        'HAR 只能证明 HTTP 层表现，无法直接看到服务端内部执行细节',
      ],
    });
  });

  // 5. 缓存问题卡片
  const { cacheRateLow, cacheRateMinRequests } = HAR_SEVERITY_THRESHOLDS;
  if (diagnosis.cacheStats.cacheRate < cacheRateLow && diagnosis.totalRequests > cacheRateMinRequests) {
    cards.push({
      id: generateId('har-cache', 0),
      source: 'har',
      category: 'cache',
      severity: 'warning',
      confidence: 'medium',
      title: '缓存命中率偏低',
      conclusion: `缓存命中率仅 ${diagnosis.cacheStats.cacheRate}%，建议优化静态资源缓存策略`,
      scope: buildScope(diagnosis.cacheStats.uncachedCount, undefined, 'global'),
      evidence: [
        { label: '缓存命中率', value: `${diagnosis.cacheStats.cacheRate}%`, source: 'har' },
        { label: '已缓存', value: `${diagnosis.cacheStats.cachedCount} 个`, source: 'har' },
        { label: '未缓存', value: `${diagnosis.cacheStats.uncachedCount} 个`, source: 'har' },
      ],
      actions: [
        {
          role: 'backend',
          title: '优化缓存配置',
          detail: '为静态资源配置合理的 Cache-Control、ETag、Last-Modified 响应头',
        },
        {
          role: 'frontend',
          title: '检查前端缓存策略',
          detail: '确保前端正确利用浏览器缓存，避免重复请求相同资源',
        },
      ],
    });
  }

  // 6. 压缩问题卡片
  if (diagnosis.uncompressedLargeResources.length > 0) {
    cards.push({
      id: generateId('har-compress', 0),
      source: 'har',
      category: 'compression',
      severity: 'warning',
      confidence: 'high',
      title: `大资源未启用压缩 (${diagnosis.uncompressedLargeResources.length} 个)`,
      conclusion: `${diagnosis.uncompressedLargeResources.length} 个大资源（>1MB）未启用 gzip/br 压缩，建议开启压缩减少传输体积`,
      scope: buildScope(diagnosis.uncompressedLargeResources.length, undefined, 'global'),
      evidence: diagnosis.uncompressedLargeResources.slice(0, 5).map((r, i) => ({
        label: `未压缩资源 ${i + 1}`,
        value: `${r.name} (${(r.size / 1024 / 1024).toFixed(2)} MB)`,
        source: 'har',
        requestIds: [r.id],
      })),
      actions: [
        {
          role: 'backend',
          title: '启用响应压缩',
          detail: '在服务端配置 gzip 或 brotli 压缩，尤其针对 JS、CSS、JSON、HTML 资源',
        },
      ],
    });
  }

  // 7. 安全问题卡片
  if (diagnosis.securityStats.mixedContentCount > 0 || diagnosis.securityStats.missingSecurityHeaders.length > 0) {
    const evidence: DiagnosticEvidence[] = [];
    const actions: DiagnosticAction[] = [];

    if (diagnosis.securityStats.mixedContentCount > 0) {
      evidence.push({
        label: '混合内容',
        value: `${diagnosis.securityStats.mixedContentCount} 个 HTTP 资源在 HTTPS 页面中加载`,
        source: 'har',
      });
      actions.push({
        role: 'frontend',
        title: '修复混合内容',
        detail: '将所有 HTTP 资源改为 HTTPS 加载，或移除不安全资源',
      });
    }

    if (diagnosis.securityStats.missingSecurityHeaders.length > 0) {
      evidence.push({
        label: '缺失安全头',
        value: diagnosis.securityStats.missingSecurityHeaders.join('、'),
        source: 'har',
      });
      actions.push({
        role: 'backend',
        title: '补充安全响应头',
        detail: `添加缺失的安全响应头：${diagnosis.securityStats.missingSecurityHeaders.join('、')}`,
      });
    }

    cards.push({
      id: generateId('har-security', 0),
      source: 'har',
      category: 'security',
      severity: diagnosis.securityStats.mixedContentCount > 0 ? 'critical' : 'warning',
      confidence: 'high',
      title: '安全策略问题',
      conclusion: diagnosis.securityStats.mixedContentCount > 0
        ? '检测到混合内容，可能导致安全警告或资源被拦截'
        : '检测到缺失安全响应头，建议补充以提升安全性',
      scope: buildScope(diagnosis.totalRequests, undefined, 'global'),
      evidence,
      actions,
    });
  }

  // 8. 重复请求卡片
  if (diagnosis.duplicateRequests.length > 0) {
    cards.push({
      id: generateId('har-dup', 0),
      source: 'har',
      category: 'performance',
      severity: 'warning',
      confidence: 'high',
      title: `重复请求检测 (${diagnosis.duplicateRequests.length} 个)`,
      conclusion: `检测到 ${diagnosis.duplicateRequests.length} 个 URL 被重复请求，浪费 ${(diagnosis.duplicateRequests.reduce((s, d) => s + d.totalWasted, 0) / 1024).toFixed(1)} KB 带宽`,
      scope: buildScope(diagnosis.duplicateRequests.reduce((s, d) => s + d.count, 0), undefined, 'global'),
      evidence: diagnosis.duplicateRequests.slice(0, 5).map((d, i) => ({
        label: `重复 ${i + 1}`,
        value: `${d.url} (×${d.count})`,
        source: 'har',
      })),
      actions: [
        {
          role: 'frontend',
          title: '消除重复请求',
          detail: '检查前端缓存策略，避免重复请求相同资源',
        },
        {
          role: 'backend',
          title: '优化缓存响应头',
          detail: '确保响应包含适当的缓存控制头',
        },
      ],
    });
  }

  // ========== 批次 B 增强：CORS 诊断 ==========
  const corsFailedEntries = entries.filter(e =>
    e.status === 0 && e.method === 'OPTIONS' && e.isFailed
  );
  const corsBlockedEntries = entries.filter(e => {
    const hasCorsHeaders = e.responseHeaders.some(h =>
      h.name.toLowerCase() === 'access-control-allow-origin'
    );
    const isXhr = e.category === 'xhr';
    const hasOrigin = e.requestHeaders.some(h => h.name.toLowerCase() === 'origin');
    return isXhr && hasOrigin && !hasCorsHeaders && e.status > 0;
  });
  if (corsFailedEntries.length > 0 || corsBlockedEntries.length > 0) {
    const evidence: DiagnosticEvidence[] = [];
    const actions: DiagnosticAction[] = [];
    if (corsFailedEntries.length > 0) {
      evidence.push({
        label: 'OPTIONS 预检失败',
        value: `${corsFailedEntries.length} 个 OPTIONS 请求失败（status=0），可能是 CORS 预检被拦截`,
        source: 'har',
        requestIds: corsFailedEntries.map(e => e.id).slice(0, 5),
      });
      actions.push({
        role: 'backend',
        title: '检查 CORS 配置',
        detail: '确认服务端正确配置了 Access-Control-Allow-Origin、Access-Control-Allow-Methods、Access-Control-Allow-Headers 响应头',
      });
      actions.push({
        role: 'user',
        title: '补充 NetLog 验证',
        detail: 'OPTIONS 失败的精确原因需要 NetLog 确认，建议补充 NetLog 文件',
      });
    }
    if (corsBlockedEntries.length > 0) {
      evidence.push({
        label: '可能被 CORS 阻止',
        value: `${corsBlockedEntries.length} 个 XHR 请求携带 Origin 但响应缺少 Access-Control-Allow-Origin`,
        source: 'derived',
        requestIds: corsBlockedEntries.map(e => e.id).slice(0, 5),
      });
      if (!actions.some(a => a.title.includes('CORS'))) {
        actions.push({
          role: 'backend',
          title: '添加 CORS 响应头',
          detail: '为需要跨域访问的接口添加 Access-Control-Allow-Origin 响应头',
        });
      }
    }
    cards.push({
      id: generateId('har-cors', 0),
      source: 'har',
      category: 'cors',
      severity: corsFailedEntries.length > 0 ? 'warning' : 'info',
      confidence: corsFailedEntries.length > 0 ? 'medium' : 'low',
      title: `CORS 跨域问题 (${corsFailedEntries.length + corsBlockedEntries.length} 个)`,
      conclusion: corsFailedEntries.length > 0
        ? `${corsFailedEntries.length} 个 OPTIONS 预检请求失败，可能导致后续跨域请求被浏览器阻止`
        : `${corsBlockedEntries.length} 个 XHR 请求可能因缺少 CORS 响应头而被浏览器阻止`,
      scope: buildScope(corsFailedEntries.length + corsBlockedEntries.length, undefined, 'global'),
      evidence,
      actions,
      limitations: corsFailedEntries.length > 0
        ? ['status=0 的精确原因需要 NetLog 验证，可能是 CORS、Mixed Content 或安全策略拦截']
        : ['当前为启发式推测，需确认浏览器控制台是否存在 CORS 报错'],
    });
  }

  // ========== 批次 B 增强：Redirect 诊断 ==========
  const { redirectSlow } = HAR_DIAG_THRESHOLDS;
  const redirectEntries = entries.filter(e => e.status >= 300 && e.status < 400);
  const longRedirectChains = redirectEntries.filter(e => e.time > redirectSlow);
  if (longRedirectChains.length > 0) {
    cards.push({
      id: generateId('har-redirect', 0),
      source: 'har',
      category: 'redirect',
      severity: 'warning',
      confidence: 'high',
      title: `重定向耗时过长 (${longRedirectChains.length} 个)`,
      conclusion: `${longRedirectChains.length} 个重定向请求耗时超过 500ms，可能存在重定向链路过长或目标服务器响应慢`,
      scope: buildScope(longRedirectChains.length, undefined, 'global'),
      evidence: longRedirectChains.slice(0, 5).map((e, i) => ({
        label: `慢重定向 ${i + 1}`,
        value: `${e.url} → ${e.status} (${e.time}ms)`,
        source: 'har',
        requestIds: [e.id],
      })),
      actions: [
        {
          role: 'backend',
          title: '优化重定向链路',
          detail: '减少不必要的重定向跳转，直接指向最终目标 URL',
        },
        {
          role: 'frontend',
          title: '更新前端链接',
          detail: '将前端代码中的 URL 直接指向最终目标，避免中间跳转',
        },
      ],
    });
  }

  // ========== 批次 B 增强：Server-Timing 利用 ==========
  const { serverTimingSlow } = HAR_DIAG_THRESHOLDS;
  const entriesWithServerTiming = entries.filter(e => e.serverTiming && e.serverTiming.length > 0);
  if (entriesWithServerTiming.length > 0) {
    const slowServerTimings = entriesWithServerTiming.filter(e => {
      const totalDur = e.serverTiming.reduce((s, st) => s + (st.dur || 0), 0);
      return totalDur > serverTimingSlow;
    });
    if (slowServerTimings.length > 0) {
      cards.push({
        id: generateId('har-stiming', 0),
        source: 'har',
        category: 'server',
        severity: 'info',
        confidence: 'high',
        title: `Server-Timing 慢请求分析 (${slowServerTimings.length} 个)`,
        conclusion: `${slowServerTimings.length} 个请求的 Server-Timing 显示服务端内部处理耗时超过 ${serverTimingSlow}ms，可据此定位服务端瓶颈`,
        scope: buildScope(slowServerTimings.length, undefined, 'server-side'),
        evidence: slowServerTimings.slice(0, 5).map((e, i) => ({
          label: `慢请求 ${i + 1}`,
          value: `${e.name} — ${e.serverTiming.map(st => `${st.name}: ${st.dur || '?'}ms`).join(', ')}`,
          source: 'har',
          requestIds: [e.id],
        })),
        actions: [
          {
            role: 'backend',
            title: '根据 Server-Timing 定位瓶颈',
            detail: 'Server-Timing 已标记各阶段耗时，据此排查数据库查询、缓存读取、业务逻辑等环节',
          },
        ],
        limitations: [
          'Server-Timing 依赖服务端主动返回，如果服务端未配置则无法获取',
          'Server-Timing 数据可能因网络传输被截断或不完整',
        ],
      });
    }
  }

  // ========== 批次 B 增强：Cookie 过大诊断 ==========
  const { cookieLarge } = HAR_DIAG_THRESHOLDS;
  const largeCookieEntries = entries.filter(e => {
    const cookieHeader = e.requestHeaders.find(h => h.name.toLowerCase() === 'cookie');
    return cookieHeader && cookieHeader.value.length > cookieLarge;
  });
  if (largeCookieEntries.length > 0) {
    const maxCookieSize = Math.max(...largeCookieEntries.map(e => {
      const cookieHeader = e.requestHeaders.find(h => h.name.toLowerCase() === 'cookie');
      return cookieHeader ? cookieHeader.value.length : 0;
    }));
    cards.push({
      id: generateId('har-cookie', 0),
      source: 'har',
      category: 'performance',
      severity: 'warning',
      confidence: 'high',
      title: `Cookie 体积过大 (${largeCookieEntries.length} 个请求)`,
      conclusion: `${largeCookieEntries.length} 个请求的 Cookie 超过 ${(cookieLarge / 1024).toFixed(0)}KB，最大 ${(maxCookieSize / 1024).toFixed(1)}KB，每次请求都会携带额外开销`,
      scope: buildScope(largeCookieEntries.length, undefined, 'global'),
      evidence: [
        {
          label: '受影响请求数',
          value: `${largeCookieEntries.length} 个请求 Cookie > ${(cookieLarge / 1024).toFixed(0)}KB`,
          source: 'har',
        },
        {
          label: '最大 Cookie 体积',
          value: `${(maxCookieSize / 1024).toFixed(1)} KB`,
          source: 'har',
        },
      ],
      actions: [
        {
          role: 'backend',
          title: '精简 Cookie',
          detail: '减少 Cookie 中存储的数据量，将非必要数据迁移到 localStorage 或服务端 Session',
        },
        {
          role: 'backend',
          title: '拆分 Cookie 域',
          detail: '将不同功能的 Cookie 分配到不同子域，减少单次请求携带的 Cookie 体积',
        },
      ],
    });
  }

  // ========== 批次 B 增强：业务 logid 摘要卡片 ==========
  const entriesWithLogid = entries.filter(e => e.xTtLogid);
  if (entriesWithLogid.length > 0) {
    const failedWithLogid = entriesWithLogid.filter(e => e.isFailed);
    const logidList = failedWithLogid.slice(0, 10).map(e => ({
      url: e.url,
      logid: e.xTtLogid,
      status: e.status,
    }));

    cards.push({
      id: generateId('har-logid', 0),
      source: 'har',
      category: 'server',
      severity: failedWithLogid.length > 0 ? 'info' : 'info',
      confidence: 'high',
      title: `业务日志 ID 摘要 (${entriesWithLogid.length} 个请求包含 logid)`,
      conclusion: failedWithLogid.length > 0
        ? `${failedWithLogid.length} 个失败请求包含 x-tt-logid，可直接用于服务端日志查询`
        : `共 ${entriesWithLogid.length} 个请求包含 x-tt-logid，可用于服务端日志关联查询`,
      scope: buildScope(entriesWithLogid.length, undefined, 'server-side'),
      evidence: logidList.map((item, i) => ({
        label: `logid ${i + 1}`,
        value: `${item.logid} — ${item.url.substring(0, 80)}${item.url.length > 80 ? '...' : ''} (status: ${item.status})`,
        source: 'har',
      })),
      actions: [
        {
          role: 'backend',
          title: '使用 logid 查询服务端日志',
          detail: `将上述 logid 提交给后端团队，在服务端日志系统中查询对应请求的完整处理链路`,
        },
      ],
    });
  }

  // 按严重程度排序
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  cards.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return cards;
}

// ========== 采集质量检测 ==========

export function checkHarQuality(result: HarAnalysisResult): CollectionQuality {
  const issues: CollectionQuality['issues'] = [];
  const missingFields: string[] = [];
  const recommendations: string[] = [];

  // 检查请求数
  if (result.totalRequests < 5) {
    issues.push({
      type: 'insufficient_data',
      severity: 'warning',
      message: '请求数量过少',
      detail: `仅 ${result.totalRequests} 个请求，可能无法完整反映网络状况`,
    });
    recommendations.push('建议在更多场景下采集 HAR 文件，确保包含完整的页面加载过程');
  }

  // 检查 timing 可用性
  const entriesWithMissingTimings = result.entries.filter(e => {
    const t = e.timings;
    return t.dns === -1 || t.connect === -1 || t.ssl === -1 || t.wait === -1;
  });
  if (entriesWithMissingTimings.length > result.totalRequests * 0.3) {
    issues.push({
      type: 'missing_field',
      severity: 'warning',
      message: '大量 timing 数据缺失',
      detail: `${entriesWithMissingTimings.length} 个请求存在 -1 timing，可能未开启 Preserve log 或采集不完整`,
    });
    missingFields.push('timings (dns, connect, ssl, wait)');
    recommendations.push('采集 HAR 时确保开启 Preserve log，并完整记录页面加载过程');
  }

  // 检查 serverIPAddress
  const missingIp = result.entries.filter(e => !e.remoteAddress || e.remoteAddress === '-');
  if (missingIp.length > result.totalRequests * 0.5) {
    issues.push({
      type: 'missing_field',
      severity: 'info',
      message: '大量请求缺少服务端 IP',
      detail: `${missingIp.length} 个请求未记录 serverIPAddress`,
    });
    missingFields.push('serverIPAddress');
  }

  // 检查 response headers
  const missingHeaders = result.entries.filter(e => e.responseHeaders.length === 0);
  if (missingHeaders.length > result.totalRequests * 0.3) {
    issues.push({
      type: 'missing_field',
      severity: 'info',
      message: '部分请求缺少响应头',
      detail: `${missingHeaders.length} 个请求未记录响应头`,
    });
    missingFields.push('responseHeaders');
  }

  // 检查采集时间跨度
  const timeSpan = result.totalTime;
  if (timeSpan > 0 && timeSpan < 1000) {
    issues.push({
      type: 'suspicious_pattern',
      severity: 'info',
      message: '采集时间跨度过短',
      detail: `仅 ${(timeSpan / 1000).toFixed(1)} 秒，可能未完整记录页面加载`,
    });
    recommendations.push('建议在页面完整加载后再停止 HAR 采集');
  }

  return {
    source: 'har',
    isDiagnosable: result.totalRequests >= 3,
    issues,
    missingFields: missingFields.length > 0 ? missingFields : undefined,
    recommendations: recommendations.length > 0 ? recommendations : undefined,
  };
}

// ========== 汇总函数 ==========

export function buildHarDiagnosisSummary(
  harResult: HarAnalysisResult,
  diagnosis: HarDiagnosisResult
): DiagnosisSummary {
  const cards = harDiagnosisToCards(harResult, diagnosis);
  const quality = checkHarQuality(harResult);

  const overallSeverity: DiagnosisSummary['overallSeverity'] =
    cards.some(c => c.severity === 'critical') ? 'critical' :
    cards.some(c => c.severity === 'warning') ? 'warning' : 'info';

  return {
    cards,
    quality,
    overallSeverity,
    healthScore: diagnosis.healthScore,
  };
}
