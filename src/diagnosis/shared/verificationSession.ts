import type { FinalAction } from './finalSummaryTypes';

export type VerificationOutcome = 'improved' | 'unchanged' | 'worse' | 'not-run';

export interface VerificationRecord {
  actionId: string;
  outcome: VerificationOutcome;
  note?: string;
}

export interface VerificationNextStep {
  status: 'needs-next-action' | 'collect-more-evidence' | 'direction-supported' | 'no-action-recorded';
  message: string;
  nextAction?: FinalAction;
  mustAvoidConfirmedRootCause: true;
}

export function evaluateVerificationSession(actions: FinalAction[], records: VerificationRecord[]): VerificationNextStep {
  if (records.length === 0) {
    return {
      status: 'no-action-recorded',
      message: '还没有记录验证结果，请先执行一条低风险行动并记录是否改善。',
      mustAvoidConfirmedRootCause: true,
    };
  }

  const improved = records.find(item => item.outcome === 'improved');
  if (improved) {
    const action = actions.find(item => item.id === improved.actionId);
    return {
      status: 'direction-supported',
      message: action
        ? `“${action.title}”后问题改善，说明该方向更值得继续验证；这仍不是新的确定根因，需要重新采集证据确认。`
        : '问题在某个行动后改善，说明该方向值得继续验证；这仍不是新的确定根因，需要重新采集证据确认。',
      mustAvoidConfirmedRootCause: true,
    };
  }

  const runIds = new Set(records.filter(item => item.outcome !== 'not-run').map(item => item.actionId));
  const nextAction = actions.find(item => !runIds.has(item.id));
  if (nextAction) {
    return {
      status: 'needs-next-action',
      message: `已记录的行动没有改善。下一步建议执行“${nextAction.title}”。`,
      nextAction,
      mustAvoidConfirmedRootCause: true,
    };
  }

  return {
    status: 'collect-more-evidence',
    message: '已记录的行动都没有改善，建议重新同时采集 HAR 与 NetLog，并补充复现时间、网络环境和代理/VPN 状态。',
    mustAvoidConfirmedRootCause: true,
  };
}
