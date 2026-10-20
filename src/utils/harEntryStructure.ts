import { isRecord } from '../parsers/shared/rootFormatGuard';

/** Only the required containers are checked here; parseHar owns field semantics. */
export function harEntryStructureIssue(entry: unknown): string | undefined {
  if (!isRecord(entry)) return '请求记录不是对象';
  if (!isRecord(entry.request)) return '缺少 request 或 request 不是对象';
  if (!isRecord(entry.response)) return '缺少 response 或 response 不是对象';
  return undefined;
}
