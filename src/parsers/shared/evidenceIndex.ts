/**
 * Event Evidence Index - 预构建事件索引表
 * 为 EventsTab 提供 O(1) 的分组过滤能力，替代每次 render 时的全量扫描
 */

import type { ParsedEvent } from '../netlog/parser';

/** 索引后的事件行（带预计算的搜索文本） */
export interface IndexedEvent extends ParsedEvent {
  /** 用于全文搜索的预串联小写文本 */
  searchText: string;
  /** params 的简短预览（截取前 50 字符） */
  paramsPreview: string;
  /** 在原始 events 数组中的下标 */
  originalIndex: number;
  /** 是否包含非零 net_error */
  hasNetError: boolean;
  /** net_error 值（若存在且非零） */
  netErrorCode?: number;
}

/** 按维度建立的反向索引 */
export interface EventIndex {
  /** 所有索引化的事件（保持原顺序） */
  rows: IndexedEvent[];
  /** sourceId → 事件下标数组 */
  bySourceId: Map<number, number[]>;
  /** sourceTypeName → 事件下标数组 */
  bySourceType: Map<string, number[]>;
  /** phaseName → 事件下标数组 */
  byPhase: Map<string, number[]>;
  /** param field name → 事件下标数组 */
  byParamField: Map<string, number[]>;
  /** 含 net_error (非零) 的事件下标数组 */
  errorIndices: number[];
  /** net_error code → 事件下标数组 */
  byErrorCode: Map<number, number[]>;
  /** 所有出现的 param field 名（已排序） */
  paramFields: string[];
  /** 所有出现的 source type 名（已排序） */
  sourceTypes: string[];
  /** 所有出现的 phase 名（已排序） */
  phases: string[];
}

/**
 * 构建事件索引。复杂度 O(n)，只在 events 变化时执行一次
 */
export function buildEventIndex(events: ParsedEvent[]): EventIndex {
  const rows: IndexedEvent[] = new Array(events.length);
  const bySourceId = new Map<number, number[]>();
  const bySourceType = new Map<string, number[]>();
  const byPhase = new Map<string, number[]>();
  const byParamField = new Map<string, number[]>();
  const errorIndices: number[] = [];
  const byErrorCode = new Map<number, number[]>();
  const paramFieldSet = new Set<string>();
  const sourceTypeSet = new Set<string>();
  const phaseSet = new Set<string>();

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const params = e.params;
    const paramsShallow = params
      ? Object.entries(params).map(([k, v]) => `${k}:${v}`).join(' ')
      : '';

    const hasNetError = params?.net_error !== undefined && params?.net_error !== 0;
    const netErrorCode = hasNetError ? Number(params.net_error) : undefined;

    rows[i] = {
      ...e,
      originalIndex: i,
      paramsPreview: paramsShallow.substring(0, 50),
      searchText: `${e.typeName} ${e.source.typeName} ${e.source.id} ${e.time} ${paramsShallow}`.toLowerCase(),
      hasNetError,
      netErrorCode,
    };

    // Source ID index
    const sid = e.source.id;
    const sidArr = bySourceId.get(sid);
    if (sidArr) sidArr.push(i);
    else bySourceId.set(sid, [i]);

    // Source Type index
    const stype = e.source.typeName;
    sourceTypeSet.add(stype);
    const stArr = bySourceType.get(stype);
    if (stArr) stArr.push(i);
    else bySourceType.set(stype, [i]);

    // Phase index
    const phase = e.phaseName;
    phaseSet.add(phase);
    const phArr = byPhase.get(phase);
    if (phArr) phArr.push(i);
    else byPhase.set(phase, [i]);

    // Param fields index
    if (params && typeof params === 'object') {
      for (const key of Object.keys(params)) {
        paramFieldSet.add(key);
        const pfArr = byParamField.get(key);
        if (pfArr) pfArr.push(i);
        else byParamField.set(key, [i]);
      }
    }

    // Error indices
    if (hasNetError) {
      errorIndices.push(i);
      if (netErrorCode !== undefined) {
        const ecArr = byErrorCode.get(netErrorCode);
        if (ecArr) ecArr.push(i);
        else byErrorCode.set(netErrorCode, [i]);
      }
    }
  }

  return {
    rows,
    bySourceId,
    bySourceType,
    byPhase,
    byParamField,
    errorIndices,
    byErrorCode,
    paramFields: Array.from(paramFieldSet).sort(),
    sourceTypes: Array.from(sourceTypeSet).sort(),
    phases: Array.from(phaseSet).sort(),
  };
}

/**
 * 利用索引进行快速过滤
 * 当有精确维度过滤时使用索引取交集，否则回退全文搜索
 */
export function queryIndex(
  index: EventIndex,
  filters: {
    sourceId?: string;
    sourceType?: string;
    phase?: string;
    paramField?: string;
    search?: string; // 已 toLowerCase
  }
): IndexedEvent[] {
  const { sourceId, sourceType, phase, paramField, search } = filters;

  // 如果有精确的 sourceId 过滤，直接用索引
  if (sourceId) {
    const sid = Number(sourceId);
    const indices = index.bySourceId.get(sid);
    if (!indices) return [];
    return indices.map(i => index.rows[i]);
  }

  // 特殊搜索：net_error（仅错误事件）
  if (search === 'net_error') {
    let candidates = index.errorIndices;
    candidates = applyDimensionFilter(candidates, index, sourceType, phase, paramField);
    return candidates.map(i => index.rows[i]);
  }

  // 特殊搜索：net_error:-105 精确匹配
  if (search && search.startsWith('net_error:')) {
    const code = Number(search.replace('net_error:', ''));
    const indices = index.byErrorCode.get(code);
    if (!indices) return [];
    let candidates = indices;
    candidates = applyDimensionFilter(candidates, index, sourceType, phase, paramField);
    return candidates.map(i => index.rows[i]);
  }

  // 有维度过滤但没有文本搜索：取交集
  if (!search && (sourceType || phase || paramField)) {
    let candidates: number[] | null = null;

    if (sourceType) {
      candidates = intersect(candidates, index.bySourceType.get(sourceType) || []);
    }
    if (phase) {
      candidates = intersect(candidates, index.byPhase.get(phase) || []);
    }
    if (paramField) {
      candidates = intersect(candidates, index.byParamField.get(paramField) || []);
    }

    return (candidates || []).map(i => index.rows[i]);
  }

  // 全文搜索 + 维度过滤：先维度后全文
  if (search) {
    let pool: IndexedEvent[];
    if (sourceType || phase || paramField) {
      let candidates: number[] | null = null;
      if (sourceType) candidates = intersect(candidates, index.bySourceType.get(sourceType) || []);
      if (phase) candidates = intersect(candidates, index.byPhase.get(phase) || []);
      if (paramField) candidates = intersect(candidates, index.byParamField.get(paramField) || []);
      pool = (candidates || []).map(i => index.rows[i]);
    } else {
      pool = index.rows;
    }
    return pool.filter(row => row.searchText.includes(search));
  }

  // 无任何过滤
  return index.rows.slice();
}

/** 对已按索引排列的候选列表应用维度过滤 */
function applyDimensionFilter(
  candidates: number[],
  index: EventIndex,
  sourceType?: string,
  phase?: string,
  paramField?: string
): number[] {
  if (sourceType) {
    candidates = intersect(candidates, index.bySourceType.get(sourceType) || []);
  }
  if (phase) {
    candidates = intersect(candidates, index.byPhase.get(phase) || []);
  }
  if (paramField) {
    candidates = intersect(candidates, index.byParamField.get(paramField) || []);
  }
  return candidates;
}

/** 两个有序数组的交集 */
function intersect(a: number[] | null, b: number[]): number[] {
  if (a === null) return b;
  if (a.length === 0 || b.length === 0) return [];

  // 如果两个都有序，使用双指针
  const result: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push(a[i]);
      i++;
      j++;
    } else if (a[i] < b[j]) {
      i++;
    } else {
      j++;
    }
  }
  return result;
}
