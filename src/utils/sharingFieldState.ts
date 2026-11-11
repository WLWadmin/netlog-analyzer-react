export type SharingFieldState =
  | { state: 'missing'; reason: 'absent-property' | 'undefined-value' }
  | { state: 'null' }
  | { state: 'redacted'; valueType: 'string'; emptiness: 'empty' | 'nonempty' }
  | { state: 'redacted'; valueType: 'object' | 'array'; emptiness: 'uninspected' }
  | { state: 'redacted'; valueType: 'number' | 'boolean' }
  | { state: 'uninspected'; reason: 'accessor-not-read' | 'inherited-property-not-read'
    | 'unsupported-value' | 'descriptor-unavailable' };

/**
 * 仅检查本地记录的 own descriptor；不调用访问器、toJSON 或进入开放容器。
 * 容器类型已知不代表内容/空值已检查；undefined 也不代表有隐藏正文。
 */
export function inspectSharingField(record: object, field: string): SharingFieldState {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, field);
    if (!descriptor) return field in record
      ? { state: 'uninspected', reason: 'inherited-property-not-read' }
      : { state: 'missing', reason: 'absent-property' };
    if (!('value' in descriptor)) return { state: 'uninspected', reason: 'accessor-not-read' };
    const value: unknown = descriptor.value;
    if (value === undefined) return { state: 'missing', reason: 'undefined-value' };
    if (value === null) return { state: 'null' };
    if (typeof value === 'string') return {
      state: 'redacted', valueType: 'string', emptiness: value === '' ? 'empty' : 'nonempty',
    };
    if (typeof value === 'object') return {
      state: 'redacted', valueType: Array.isArray(value) ? 'array' : 'object', emptiness: 'uninspected',
    };
    if (typeof value === 'number') return { state: 'redacted', valueType: 'number' };
    if (typeof value === 'boolean') return { state: 'redacted', valueType: 'boolean' };
    return { state: 'uninspected', reason: 'unsupported-value' };
  } catch {
    // 非本地普通记录/已撤销代理不能安全检查，不能将异常伪装为 missing。
    return { state: 'uninspected', reason: 'descriptor-unavailable' };
  }
}
