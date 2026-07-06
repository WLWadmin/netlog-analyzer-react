import { buildDiagnosisEvidenceGuardReport, scanConfirmedTextForForbiddenEvidence } from './diagnosisEvidenceGuardReport';
import { buildFinalDiagnosisSummary } from './finalSummaryBuilder';
import type { DiagnosticCard, DiagnosisSummary } from './types';
import type { FinalDiagnosisSummary } from './finalSummaryTypes';

function card(overrides: Partial<DiagnosticCard>): DiagnosticCard {
  return {
    id: 'card-1',
    source: 'netlog',
    category: 'connect',
    severity: 'warning',
    confidence: 'high',
    title: '候选证据',
    conclusion: '仅发现候选证据',
    scope: { type: 'unknown', summary: '未知影响范围' },
    evidence: [],
    actions: [],
    ...overrides,
  };
}

function summary(cards: DiagnosticCard[]): DiagnosisSummary {
  return {
    cards,
    quality: {
      source: 'netlog',
      isDiagnosable: true,
      issues: [],
    },
    overallSeverity: 'warning',
  };
}

describe('buildDiagnosisEvidenceGuardReport', () => {
  it('统计 final summary 的证据级别和 evidence-gap card', () => {
    const finalSummary = buildFinalDiagnosisSummary(summary([
      card({
        id: 'socket-peer-candidate',
        title: 'Socket peer 候选',
        conclusion: '发现 socket peer 候选，但没有 request/source 锚点，不能推断请求影响范围。',
        evidence: [
          { label: 'association', value: 'global-candidate', source: 'netlog' },
          { label: 'evidence-gap', value: '缺少 URL_REQUEST source chain', source: 'netlog' },
        ],
        limitations: ['证据缺口：缺少 request/source 锚点。'],
      }),
      card({
        id: 'state-only-proxy',
        category: 'proxy',
        title: '代理配置事实',
        conclusion: '仅检测到代理配置事实，不能推断为根因。',
        evidence: [
          { label: 'proxy config', value: 'PROXY proxy.example.com:8080', source: 'netlog' },
        ],
      }),
    ]), 'netlog');

    const report = buildDiagnosisEvidenceGuardReport(finalSummary);

    expect(report.confirmedCount).toBe(0);
    expect(report.needsMoreDataHeadlineCount + report.symptomOnlyCount + report.highlyLikelyCount).toBeGreaterThan(0);
    expect(report.missingInfoCount).toBeGreaterThan(0);
    expect(report.evidenceGapCardCount).toBeGreaterThan(0);
    expect(report.forbiddenConfirmedMatches).toEqual([]);
  });

  it('发现 confirmed 结论中的候选证据禁用标记', () => {
    const finalSummary: FinalDiagnosisSummary = {
      mode: 'netlog',
      status: 'has-conclusion',
      headline: [{
        id: 'bad-confirmed',
        kind: 'confirmed',
        source: 'netlog',
        category: 'connect',
        title: 'Socket peer confirmed',
        problem: 'socket peer 候选被当成根因',
        reason: 'association=global-candidate',
        impact: '影响范围未知',
        confidence: 'high',
        confidenceText: '高',
        keyEvidence: [
          { label: 'socket peer', value: '203.0.113.10:443', source: 'netlog' },
        ],
        missingInfo: [],
        relatedCardIds: [],
        score: 100,
        displayRank: 1,
        userFacingSummary: '已确认 socket peer 为根因。',
      }],
      rootCauseClusters: [],
      actionPlan: [],
      missingInfo: [],
      expertCards: [],
      executiveSummary: 'bad',
    };

    const report = buildDiagnosisEvidenceGuardReport(finalSummary);

    expect(report.confirmedCount).toBe(1);
    expect(report.forbiddenConfirmedMatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ conclusionId: 'bad-confirmed', token: 'socket peer' }),
      expect.objectContaining({ conclusionId: 'bad-confirmed', token: 'global-candidate' }),
    ]));
  });

  it('扫描导出/复制文本中的 confirmed state fact 误包装', () => {
    expect(scanConfirmedTextForForbiddenEvidence('候选线索：socket peer 是 203.0.113.10，仅作为排查线索。')).toEqual([]);
    expect(scanConfirmedTextForForbiddenEvidence('不能确认根因：socket peer 是候选线索。')).toEqual([]);
    expect(scanConfirmedTextForForbiddenEvidence('已确认根因：proxy config 导致请求失败。')).toEqual([
      expect.objectContaining({ token: 'proxy config' }),
    ]);
    expect(scanConfirmedTextForForbiddenEvidence('confirmed: quic state caused the issue')).toEqual([
      expect.objectContaining({ token: 'quic state' }),
    ]);
  });
});
