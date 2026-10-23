import type { ParsedEvent, URLRequest } from './parser';

export interface RequestOutcomeEvidence {
  state: 'failed' | 'succeeded' | 'cancelled' | 'incomplete' | 'unknown';
  directErrorCount: number;
  firstErrorEventId?: number;
  terminalEventId?: number;
  terminalTime?: number;
  terminalCode?: number;
}

export function collectRequestOutcome(
  previous: RequestOutcomeEvidence | undefined,
  event: ParsedEvent,
  eventId: number,
): RequestOutcomeEvidence {
  const outcome = previous ?? { state: 'incomplete', directErrorCount: 0 };
  if (event.source.typeName !== 'URL_REQUEST') return outcome;
  const raw = event.params.net_error;
  const code = typeof raw === 'number' ? raw
    : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : undefined;
  const finiteCode = code !== undefined && Number.isInteger(code) ? code : undefined;
  // These are control-flow results, not request failures. Protocol-specific
  // error_code fields are deliberately excluded from Chromium NetError facts.
  if (finiteCode !== undefined && finiteCode < 0 && ![-1, -173, -406].includes(finiteCode)) {
    outcome.directErrorCount += 1;
    outcome.firstErrorEventId ??= eventId;
  }
  // Header receipt, job completion and connected-source END events cannot
  // establish completion of the URL_REQUEST lifetime.
  if (event.typeName === 'REQUEST_ALIVE' && event.phaseName === 'END'
    && (outcome.terminalTime === undefined || event.time >= outcome.terminalTime)) {
    outcome.terminalEventId = eventId;
    outcome.terminalTime = event.time;
    outcome.terminalCode = finiteCode;
    outcome.state = finiteCode === 0 ? 'succeeded'
      : finiteCode === -3 ? 'cancelled'
      : finiteCode !== undefined && finiteCode < 0 && ![-1, -173, -406].includes(finiteCode)
        ? 'failed' : 'unknown';
  }
  return outcome;
}

export function describeRequestOutcome(request: URLRequest): { label: string; explanation: string } {
  const outcome = request.outcome;
  switch (outcome?.state) {
    case 'succeeded':
      return {
        label: outcome.directErrorCount > 0 ? '成功（曾有错误）' : '已完成',
        explanation: '请求生命周期结束事件明确记录 net_error=0；这只证明本次传输完成，HTTP 状态和整个网络问题是否恢复需另行复核。',
      };
    case 'failed':
      return { label: '最终失败', explanation: '请求生命周期结束事件明确记录失败码，可追溯对应 source 和原始结束事件。' };
    case 'cancelled':
      return { label: '已取消', explanation: '结束事件记录 ERR_ABORTED，可能由页面导航或用户取消触发，不能直接认定为网络故障。' };
    case 'incomplete':
      return { label: '未见结束', explanation: '采集范围内未发现明确的请求生命周期结束事件；不能由响应头或连接 END 推断成功，也不能证明请求在采集后仍未完成。' };
    default:
      return { label: '结果未知', explanation: '缺少带明确结果的请求结束证据。已有错误或 HTTP 响应可作线索，但不足以确认最终结果。' };
  }
}
