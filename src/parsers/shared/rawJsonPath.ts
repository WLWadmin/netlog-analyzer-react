/**
 * Raw JSON Path Utilities
 * 支持在原始 JSON 数据中通过路径表达式搜索特定字段
 * 用于 Raw Evidence Explorer 组件
 */

export interface JsonPathMatch {
  /** 完整的 JSON 路径（如 "events[123].params.net_error"） */
  path: string;
  /** 匹配到的值 */
  value: unknown;
  /** 值的类型 */
  type: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';
  /** 所在的数组下标（如果有） */
  index?: number;
}

/**
 * 在 JSON 对象中搜索包含指定关键词的路径
 * @param data - 要搜索的 JSON 数据
 * @param keyword - 搜索关键词（匹配路径或值）
 * @param maxResults - 最大返回数量
 * @param maxDepth - 最大搜索深度
 */
export function searchJsonPaths(
  data: unknown,
  keyword: string,
  maxResults = 200,
  maxDepth = 10
): JsonPathMatch[] {
  const results: JsonPathMatch[] = [];
  const lower = keyword.toLowerCase();

  function walk(obj: unknown, path: string, depth: number) {
    if (results.length >= maxResults || depth > maxDepth) return;

    if (obj === null || obj === undefined) {
      if (path.toLowerCase().includes(lower)) {
        results.push({ path, value: obj, type: 'null' });
      }
      return;
    }

    if (Array.isArray(obj)) {
      if (path.toLowerCase().includes(lower)) {
        results.push({ path, value: `Array(${obj.length})`, type: 'array' });
      }
      for (let i = 0; i < obj.length && results.length < maxResults; i++) {
        walk(obj[i], `${path}[${i}]`, depth + 1);
      }
      return;
    }

    if (typeof obj === 'object') {
      for (const key of Object.keys(obj as Record<string, unknown>)) {
        if (results.length >= maxResults) break;
        const childPath = path ? `${path}.${key}` : key;
        const val = (obj as Record<string, unknown>)[key];

        // 路径名匹配
        if (key.toLowerCase().includes(lower)) {
          results.push({
            path: childPath,
            value: val,
            type: getType(val),
          });
          // 如果值是复杂对象，不继续展开这个分支（已经报告了）
          if (typeof val !== 'object' || val === null) continue;
        }

        // 值匹配（原始值）
        if (typeof val !== 'object' && val !== null) {
          const strVal = String(val).toLowerCase();
          if (strVal.includes(lower) && !key.toLowerCase().includes(lower)) {
            results.push({
              path: childPath,
              value: val,
              type: getType(val),
            });
            continue;
          }
        }

        // 递归搜索子对象
        if (typeof val === 'object' && val !== null) {
          walk(val, childPath, depth + 1);
        }
      }
      return;
    }

    // 原始值
    const strVal = String(obj).toLowerCase();
    if (path.toLowerCase().includes(lower) || strVal.includes(lower)) {
      results.push({ path, value: obj, type: getType(obj) });
    }
  }

  walk(data, '', 0);
  return results;
}

/**
 * 通过精确路径获取 JSON 中的值
 * 支持点号和方括号语法: "events[0].params.net_error"
 */
export function getValueByPath(data: unknown, path: string): unknown {
  if (!path) return data;

  const segments = parsePath(path);
  let current: unknown = data;

  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;

    if (typeof seg === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[seg];
    } else {
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[seg];
    }
  }

  return current;
}

/**
 * 获取 JSON 对象的顶层结构概览
 */
export function getStructureOverview(data: unknown, maxDepth = 2): StructureNode[] {
  const nodes: StructureNode[] = [];

  function walk(obj: unknown, path: string, depth: number) {
    if (depth > maxDepth || obj === null || obj === undefined) return;

    if (Array.isArray(obj)) {
      nodes.push({
        path,
        key: path.split('.').pop() || 'root',
        type: 'array',
        childCount: obj.length,
        preview: `Array(${obj.length})`,
      });
      if (depth < maxDepth && obj.length > 0) {
        // 只展示第一个元素的结构
        walk(obj[0], `${path}[0]`, depth + 1);
      }
      return;
    }

    if (typeof obj === 'object') {
      const keys = Object.keys(obj as Record<string, unknown>);
      nodes.push({
        path,
        key: path.split('.').pop() || 'root',
        type: 'object',
        childCount: keys.length,
        preview: `{${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', ...' : ''}}`,
      });
      if (depth < maxDepth) {
        for (const key of keys) {
          const childPath = path ? `${path}.${key}` : key;
          walk((obj as Record<string, unknown>)[key], childPath, depth + 1);
        }
      }
      return;
    }

    nodes.push({
      path,
      key: path.split('.').pop() || 'root',
      type: getType(obj),
      preview: String(obj).substring(0, 100),
    });
  }

  walk(data, '', 0);
  return nodes;
}

export interface StructureNode {
  path: string;
  key: string;
  type: string;
  childCount?: number;
  preview: string;
}

// ============ Helpers ============

function getType(val: unknown): JsonPathMatch['type'] {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val as JsonPathMatch['type'];
}

function parsePath(path: string): (string | number)[] {
  const segments: (string | number)[] = [];
  let current = '';

  for (let i = 0; i < path.length; i++) {
    const char = path[i];
    if (char === '.') {
      if (current) segments.push(current);
      current = '';
    } else if (char === '[') {
      if (current) segments.push(current);
      current = '';
      const end = path.indexOf(']', i);
      if (end > i) {
        const idx = path.substring(i + 1, end);
        segments.push(Number(idx));
        i = end;
      }
    } else {
      current += char;
    }
  }
  if (current) segments.push(current);

  return segments;
}
