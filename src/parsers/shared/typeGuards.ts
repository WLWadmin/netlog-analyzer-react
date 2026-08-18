/**
 * 基础类型保护工具
 * 用于减少 any 与不安全的类型断言
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

