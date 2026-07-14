import type { DiagnosticCard } from './types';
import type { FinalAction, FinalDiagnosisSummary } from './finalSummaryTypes';
import {
  buildTroubleshootingPlan,
  continueTroubleshootingSession,
  createTroubleshootingSession,
  getRelevantRoleTasks,
  recordTroubleshootingOutcome,
} from './troubleshootingSop';

function card(id: string, category: DiagnosticCard['category']): DiagnosticCard {
  return {
    id,
    source: 'netlog',
    category,
    severity: 'warning',
    confidence: 'medium',
    title: `${category} 线索`,
    conclusion: `${category} 待验证`,
    scope: { type: 'global', summary: '全局' },
    evidence: [],
    actions: [],
  };
}

function action(id: string, title: string, sourceCardId: string): FinalAction {
  return {
    id,
    title,
    detail: `${title}的操作说明`,
    expectedResult: '重新访问并观察是否恢复',
    sourceCardId,
    priority: 1,
  };
}

function summary(options?: { userActions?: FinalAction[]; includeProxyIt?: boolean }): FinalDiagnosisSummary {
  const userActions = options?.userActions ?? [
    action('proxy-off', '临时关闭代理/VPN后重试', 'proxy-card'),
    action('switch-network', '切换网络验证 DNS', 'dns-card'),
    action('reduce-browser-load', '减少并发后复现', 'queue-card'),
    action('extra', '不应展示的第四步', 'connect-card'),
  ];
  const expertCards = [
    card('proxy-card', 'proxy'),
    card('dns-card', 'dns'),
    card('queue-card', 'browser-queue'),
    card('connect-card', 'connect'),
  ];

  return {
    mode: 'netlog',
    status: 'has-conclusion',
    headline: [{
      id: 'headline',
      kind: 'highly-likely',
      source: 'netlog',
      category: 'proxy',
      title: '代理待验证',
      problem: '当前存在代理配置',
      reason: '记录到 fixed_servers',
      impact: '影响访问',
      confidence: 'medium',
      confidenceText: '中',
      keyEvidence: [],
      missingInfo: [],
      relatedCardIds: ['proxy-card'],
      score: 80,
      displayRank: 1,
      userFacingSummary: '代理可能影响访问',
    }],
    rootCauseClusters: [],
    actionPlan: [
      ...(userActions.length > 0 ? [{ role: 'user' as const, title: '用户先做', actions: userActions, priority: 1 }] : []),
      ...(options?.includeProxyIt === false ? [] : [{
        role: 'it' as const,
        title: 'IT / 网络管理员处理',
        actions: [action('proxy-pac', '检查 PAC 和 CONNECT 隧道', 'proxy-card')],
        priority: 2,
      }]),
      {
        role: 'backend',
        title: '后端处理',
        actions: [action('backend-log', '检查服务日志', 'connect-card')],
        priority: 4,
      },
    ],
    missingInfo: [],
    expertCards,
    executiveSummary: '代理可能影响访问',
  };
}

describe('troubleshootingSop', () => {
  it('按来源卡映射问题方向，并且最多展示三个小白操作', () => {
    const plan = buildTroubleshootingPlan(summary());

    expect(plan.steps).toHaveLength(3);
    expect(plan.steps.map(step => step.category)).toEqual(['proxy', 'dns', 'browser-queue']);
    expect(plan.steps[0].problemTitle).toBe('代理或 VPN 可能影响了这次访问');
    expect(plan.steps[0].rollback).toContain('重新开启');
  });

  it('恢复后只标记当前方向得到支持，并给出对应角色的永久处理任务', () => {
    const plan = buildTroubleshootingPlan(summary());
    const session = recordTroubleshootingOutcome(plan, createTroubleshootingSession(plan), 'improved');

    expect(session.state).toBe('DIRECTION_SUPPORTED');
    expect(session.supportedDirections).toEqual(['proxy']);
    expect(getRelevantRoleTasks(plan, session).map(task => task.role)).toEqual(['it']);
  });

  it('恢复方向没有对应专业任务时不展示其他方向的角色任务', () => {
    const plan = buildTroubleshootingPlan(summary({ includeProxyIt: false }));
    const session = recordTroubleshootingOutcome(plan, createTroubleshootingSession(plan), 'improved');

    expect(getRelevantRoleTasks(plan, session)).toEqual([]);
  });

  it('未恢复时先要求回滚，再进入下一个不同方向', () => {
    const plan = buildTroubleshootingPlan(summary());
    const result = recordTroubleshootingOutcome(plan, createTroubleshootingSession(plan), 'unchanged');

    expect(result.state).toBe('ROLLBACK_REQUIRED');
    expect(result.pendingStepIndex).toBe(1);

    const next = continueTroubleshootingSession(result);
    expect(next.state).toBe('ACTION_PENDING');
    expect(next.currentStepIndex).toBe(1);
  });

  it('操作后变差时要求回滚，并在回滚后停止该方向转交处理', () => {
    const plan = buildTroubleshootingPlan(summary());
    const result = recordTroubleshootingOutcome(plan, createTroubleshootingSession(plan), 'worse');

    expect(result.state).toBe('ROLLBACK_REQUIRED');
    expect(result.pendingStepIndex).toBeUndefined();
    expect(continueTroubleshootingSession(result).state).toBe('HANDOFF_READY');
  });

  it('没有用户可安全执行的操作时直接转交专业角色', () => {
    const plan = buildTroubleshootingPlan(summary({ userActions: [], includeProxyIt: false }));
    const session = createTroubleshootingSession(plan);

    expect(session.state).toBe('HANDOFF_READY');
    expect(plan.steps).toHaveLength(0);
    expect(getRelevantRoleTasks(plan, session).map(task => task.role)).toEqual(['backend']);
  });

  it('敏感操作不进入小白步骤', () => {
    const sensitiveAction = {
      ...action('raw-request', '导出完整请求信息', 'proxy-card'),
      risk: 'sensitive' as const,
    };
    const plan = buildTroubleshootingPlan(summary({ userActions: [sensitiveAction] }));

    expect(plan.steps).toHaveLength(0);
    expect(createTroubleshootingSession(plan).state).toBe('HANDOFF_READY');
  });
});
