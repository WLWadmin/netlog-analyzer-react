import type { TagProps } from 'antd';

export type StatusType = 'success' | 'warning' | 'error' | 'info' | 'default';

export const TAG_CONFIG: Record<StatusType, { color: TagProps['color']; style: React.CSSProperties }> = {
  success: { color: 'success', style: { fontSize: 11, border: 'none', fontWeight: 600 } },
  warning: { color: 'warning', style: { fontSize: 11, border: 'none', fontWeight: 600 } },
  error:   { color: 'error',   style: { fontSize: 11, border: 'none', fontWeight: 600 } },
  info:    { color: 'blue',    style: { fontSize: 11, border: 'none', fontWeight: 500 } },
  default: { color: 'default', style: { fontSize: 11, border: 'none', fontWeight: 500 } },
};

export function getStatusTagType(statusCode: number): StatusType {
  if (statusCode >= 200 && statusCode < 300) return 'success';
  if (statusCode >= 300 && statusCode < 400) return 'info';
  if (statusCode >= 400 && statusCode < 500) return 'warning';
  if (statusCode >= 500) return 'error';
  return 'default';
}
