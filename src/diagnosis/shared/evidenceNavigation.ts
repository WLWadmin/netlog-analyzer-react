import type { NavigationIntent } from '../../contexts/NavigationContext';
import type { DiagnosticCard } from './types';

// 诊断卡“查看证据”的目标 tab（允许扩展到性能/协议等 tab，因此用 string）
export type EvidenceNavigationKind = string;

export interface EvidenceNavigationTarget {
  kind: EvidenceNavigationKind;
  label: string;
  intent: NavigationIntent;
}

function uniqBy<T>(arr: T[], keyFn: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function getFirstFieldPath(card: DiagnosticCard): string | undefined {
  for (const ev of card.evidence || []) {
    if (ev.fieldPath && ev.fieldPath.trim()) return ev.fieldPath.trim();
  }
  return undefined;
}

function guessFileTypeForCard(card: DiagnosticCard): 'har' | 'netlog' {
  // 注意：联合诊断的 relatedRequestIds 当前指向 HAR entry.id，因此默认回 HAR
  if (card.source === 'har' || card.source === 'combined') return 'har';
  return 'netlog';
}

function guessFileTypeForTab(card: DiagnosticCard, tab: string): 'har' | 'netlog' {
  if (tab === 'events') return 'netlog';
  if (tab === 'raw-evidence') return guessFileTypeForCard(card);
  // requests/performance/diagnosis/combined/overview 等
  return guessFileTypeForCard(card);
}

/**
 * 为诊断卡构建“证据跳转”入口（可多入口）。
 *
 * 目标：
 * - 让卡片尽可能“一键到证据”：HAR request / NetLog events / Raw JSON fieldPath
 * - 优先复用 card.navigationTarget，其次从 relatedRequestIds / relatedSourceIds / evidence.fieldPath 推导
 */
export function buildEvidenceNavigationTargets(card: DiagnosticCard): EvidenceNavigationTarget[] {
  const targets: EvidenceNavigationTarget[] = [];

  // 1) card.navigationTarget（最高优先级）
  if (card.navigationTarget) {
    const { tab, keyword, errorCode, errorOnly, requestIds, sourceIds } = card.navigationTarget;
    const fileType = guessFileTypeForTab(card, tab);
    targets.push({
      kind: tab as EvidenceNavigationKind,
      label: tab === 'events' ? '查看事件' : tab === 'raw-evidence' ? '查看原始字段' : '查看请求',
      intent: {
        tab,
        fileType,
        evidenceSource: fileType,
        filters: {
          ...(keyword && { keyword }),
          ...(errorCode && { errorCode }),
          ...(errorOnly && { errorOnly }),
          ...(requestIds?.length === 1 && { requestId: requestIds[0] }),
          ...(tab === 'raw-evidence' && keyword && { paramField: keyword }),
        },
        highlight: {
          ...(requestIds && { requestIds }),
          ...(sourceIds && { sourceIds }),
        },
      },
    });
  }

  // 2) 请求证据（HAR / NetLog 的 request 都落在各自的 requests tab）
  if (card.relatedRequestIds && card.relatedRequestIds.length > 0) {
    const fileType = guessFileTypeForCard(card);
    targets.push({
      kind: 'requests',
      label: fileType === 'har' ? '查看 HAR 请求' : '查看 NetLog 请求',
      intent: {
        tab: 'requests',
        fileType,
        evidenceSource: fileType,
        filters: {
          ...(card.relatedRequestIds.length === 1 && { requestId: card.relatedRequestIds[0] }),
        },
        highlight: { requestIds: card.relatedRequestIds },
      },
    });
  }

  // 3) NetLog source 证据
  if (card.relatedSourceIds && card.relatedSourceIds.length > 0) {
    targets.push({
      kind: 'events',
      label: '查看事件',
      intent: {
        tab: 'events',
        fileType: 'netlog',
        evidenceSource: 'netlog',
        filters: {
          ...(card.relatedSourceIds.length === 1 && { sourceId: String(card.relatedSourceIds[0]) }),
        },
        highlight: { sourceIds: card.relatedSourceIds },
      },
    });
  }

  // 4) Raw evidence：优先使用 evidence.fieldPath（只取首个，避免按钮爆炸）
  const fieldPath = getFirstFieldPath(card);
  if (fieldPath) {
    // 尝试使用 evidence.originalSource（联合诊断时更精确）；否则按 card.source 推断
    const ev = (card.evidence || []).find(e => e.fieldPath && e.fieldPath.trim());
    const fileType = (ev?.originalSource || (card.source === 'netlog' ? 'netlog' : 'har')) as 'har' | 'netlog';
    targets.push({
      kind: 'raw-evidence',
      label: fileType === 'har' ? '查看 HAR 原始字段' : '查看 NetLog 原始字段',
      intent: {
        tab: 'raw-evidence',
        fileType,
        evidenceSource: fileType,
        filters: {
          // RawEvidenceExplorer 兼容 keyword / paramField 两种入口
          keyword: fieldPath,
          paramField: fieldPath,
        },
      },
    });
  }

  // 去重：同 kind + requestId/sourceId/keyword 的目标只保留第一个（优先级顺序已在上方保证）
  return uniqBy(targets, (t) => {
    const f = t.intent.filters || {};
    return [
      t.kind,
      String((f as any).requestId ?? ''),
      String((f as any).sourceId ?? ''),
      String((f as any).keyword ?? ''),
      String((f as any).paramField ?? ''),
    ].join('|');
  });
}
