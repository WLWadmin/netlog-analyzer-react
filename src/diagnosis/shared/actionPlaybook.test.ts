import type { DiagnosticCard, DiagnosticCategory } from './types';
import { enrichActionsWithPlaybook, getPlaybookActions } from './actionPlaybook';
import { buildFinalDiagnosisSummary } from './finalSummaryBuilder';

const categories: DiagnosticCategory[] = ['dns', 'connect', 'tls', 'proxy', 'network-change', 'server', 'cors', 'performance'];

function card(category: DiagnosticCategory): DiagnosticCard {
  return {
    id: `${category}-card`,
    source: 'combined',
    category,
    severity: 'critical',
    confidence: 'high',
    title: `${category} issue`,
    conclusion: `${category} failed`,
    scope: { type: 'single-domain', summary: '1 domain', affectedRequestCount: 2, affectedDomainCount: 1 },
    evidence: [{ label: '证据', value: `${category}.example.test`, source: 'netlog' }],
    actions: [],
  };
}

describe('actionPlaybook', () => {
  it.each(categories)('provides low-effort action with closure fields for %s', category => {
    const actions = getPlaybookActions(category);

    expect(actions.some(action => action.effort === 'low')).toBe(true);
    actions.forEach(action => {
      expect(action.expectedResult).toBeTruthy();
      expect(action.nextIfFailed).toBeTruthy();
      expect(action.resultImprovesMeaning).toContain('不直接生成新的确定根因');
      expect(action.risk).toMatch(/safe|needs-approval|sensitive/);
    });
  });

  it('marks system-changing actions as needs-approval', () => {
    expect(getPlaybookActions('proxy').some(action => action.risk === 'needs-approval')).toBe(true);
    expect(getPlaybookActions('tls').some(action => action.risk === 'needs-approval')).toBe(true);
  });

  it('enriches card actions without dropping existing actions', () => {
    const enriched = enrichActionsWithPlaybook({
      ...card('dns'),
      actions: [{ role: 'user', title: '已有动作', detail: '先做已有动作' }],
    });

    expect(enriched[0]).toMatchObject({ title: '已有动作', effort: 'low', risk: 'safe' });
    expect(enriched.some(action => action.title.includes('切换网络'))).toBe(true);
  });

  it('final summary actions include expected result, next step, role, risk and effort', () => {
    const result = buildFinalDiagnosisSummary({
      cards: [card('dns')],
      quality: { source: 'combined', isDiagnosable: true, issues: [] },
      overallSeverity: 'critical',
    }, 'combined');
    const action = result.rootCauseClusters.flatMap(cluster => cluster.actions)[0];

    expect(action.expectedResult).toBeTruthy();
    expect(action.nextIfFailed).toBeTruthy();
    expect(action.effort).toBeTruthy();
    expect(action.risk).toBeTruthy();
  });
});
