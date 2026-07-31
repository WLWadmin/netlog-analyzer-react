import type { TraceAnalysisResult, TraceDiagnosis } from '../../diagnosis/trace';
import {
  buildTraceDiagnosisViewModel,
  traceEvidenceDomId,
  traceFactDomId,
} from './traceDiagnosisViewModel';

const diagnosis: TraceDiagnosis = {
  id: 'network-diagnosis', ruleId: 'N1', category: 'network', severity: 'warning', score: 80,
  title: 'HTTP 404', conclusion: 'Trace 中记录到 HTTP 404 响应。', confidence: 'observation',
  evidenceIds: ['trace:event:7', 'trace:event:8', 'trace:event:9', 'trace:event:10'],
  counterEvidence: ['存在 HTTP 响应。'],
  advice: ['建议 1', '建议 2', '建议 3', '建议 4'],
  navigationKey: 'nav-1', factIds: ['request-1'], limitations: [],
};

const result = {
  intake: { format: 'chromium-trace-object', encoding: 'plain-json', jsonBytes: 10, eventCount: 1, availableFamilies: [], warnings: [] },
  context: {
    processes: [], threads: [], frames: [], navigations: [], evidence: [
      { evidenceId: 'trace:event:7', eventIndex: 7, origin: 'raw', name: 'ResourceReceiveResponse' },
    ], evidenceTotalCount: 1, evidenceReturnedCount: 1,
    quality: { level: 'good', captureWindow: 'available', navigationContext: 'available', processThreadMetadata: 'available', frameHierarchy: 'available', rendererMainThread: 'available', skippedEventCount: 0, warnings: [], disabledCapabilities: [] },
    warnings: [],
  },
  diagnosis: { diagnoses: [diagnosis], evaluations: [] },
} as TraceAnalysisResult;

describe('traceDiagnosisViewModel', () => {
  it('每张卡只投影可用证据、最多三条证据和三条建议', () => {
    const card = buildTraceDiagnosisViewModel(result).cards[0];

    expect(card.conclusion).toBe(diagnosis.conclusion);
    expect(card.evidenceIds).toEqual(['trace:event:7']);
    expect(card.advice).toEqual(['建议 1', '建议 2', '建议 3']);
    expect(card.severityLabel).toBe('警告');
  });

  it.each([
    ['quality', 'overview'], ['loading', 'overview'], ['network', 'network'],
    ['security', 'network'], ['main-thread', 'main-thread'],
    ['rendering', 'rendering'], ['interaction', 'interactions'],
  ] as const)('%s 诊断跳到正确事实页', (category, tab) => {
    const card = buildTraceDiagnosisViewModel({
      ...result,
      diagnosis: { diagnoses: [{ ...diagnosis, category }], evaluations: [] },
    }).cards[0];

    expect(card.factTarget).toEqual({ tab, factId: 'request-1' });
  });

  it('证据目标只指向 context.evidence 中存在的首条详情', () => {
    const card = buildTraceDiagnosisViewModel(result).cards[0];
    expect(card.evidenceTarget).toEqual({ tab: 'evidence', evidenceId: 'trace:event:7' });
  });

  it('DOM id 对特殊字符稳定编码', () => {
    expect(traceFactDomId('request:/1')).toBe('trace-fact-request%3A%2F1');
    expect(traceEvidenceDomId('trace:event:7')).toBe('trace-evidence-trace%3Aevent%3A7');
  });

  it('只选择一条主结论和最多两条次结论，安全 HTTP 观察不抢主结论', () => {
    const model = buildTraceDiagnosisViewModel({
      ...result,
      diagnosis: {
        diagnoses: [
          { ...diagnosis, id: 'security', ruleId: 'S1', category: 'security', score: 99, title: 'HTTP 403' },
          { ...diagnosis, id: 'main-thread', ruleId: 'M1', category: 'main-thread', score: 80, title: '主线程长任务', confidence: 'high' },
          { ...diagnosis, id: 'rendering', ruleId: 'R1', category: 'rendering', score: 70, title: '渲染线索' },
          { ...diagnosis, id: 'interaction', ruleId: 'I1', category: 'interaction', score: 60, title: '交互线索' },
        ],
        evaluations: [],
      },
    });

    expect(model.primary?.id).toBe('main-thread');
    expect(model.secondary.map(card => card.id)).toEqual(['security', 'rendering']);
    expect(model.cards).toHaveLength(3);
  });

  it('observation 使用观察文案，并投影反证、限制和中文置信度', () => {
    const card = buildTraceDiagnosisViewModel({
      ...result,
      diagnosis: { diagnoses: [{ ...diagnosis, limitations: ['不能确定底层网络根因。'] }], evaluations: [] },
    }).cards[0];

    expect(card.summary).toBe(`观察：${diagnosis.conclusion}`);
    expect(card.confidenceLabel).toBe('观察');
    expect(card.counterEvidence).toEqual(['存在 HTTP 响应。']);
    expect(card.limitations).toEqual(['不能确定底层网络根因。']);
  });

  it('quality 即使没有 factIds 也跳到 overview 质量锚点', () => {
    const card = buildTraceDiagnosisViewModel({
      ...result,
      diagnosis: { diagnoses: [{ ...diagnosis, category: 'quality', factIds: [] }], evaluations: [] },
    }).cards[0];

    expect(card.factTarget).toEqual({ tab: 'overview', factId: 'quality' });
    expect(traceFactDomId('quality')).toBe('trace-fact-quality');
  });


  it('N1 observation 与 security observation 都不参与主结论竞争', () => {
    const model = buildTraceDiagnosisViewModel({
      ...result,
      diagnosis: { diagnoses: [
        { ...diagnosis, id: 'n1', ruleId: 'N1', score: 100 },
        { ...diagnosis, id: 'security', ruleId: 'S1', category: 'security', score: 99 },
        { ...diagnosis, id: 'main', ruleId: 'M1', category: 'main-thread', confidence: 'medium', score: 50 },
      ], evaluations: [] },
    });

    expect(model.primary?.id).toBe('main');
  });

  it('全为 observation 时不伪造主结论并给出精确提示', () => {
    const model = buildTraceDiagnosisViewModel({
      ...result,
      diagnosis: { diagnoses: [
        diagnosis,
        { ...diagnosis, id: 'security', ruleId: 'S1', category: 'security' },
      ], evaluations: [] },
    });

    expect(model.primary).toBeUndefined();
    expect(model.observationOnlyMessage).toBe('证据不足，当前只能看到以下现象');
    expect(model.secondary).toHaveLength(2);
  });

  it('首屏所有卡片合计最多三条证据和三条建议', () => {
    const model = buildTraceDiagnosisViewModel({
      ...result,
      diagnosis: { diagnoses: [
        { ...diagnosis, id: 'main', ruleId: 'M1', category: 'main-thread', confidence: 'high', score: 90 },
        { ...diagnosis, id: 'render', ruleId: 'R1', category: 'rendering', score: 80 },
        { ...diagnosis, id: 'interaction', ruleId: 'I1', category: 'interaction', score: 70 },
      ], evaluations: [] },
    });

    const evidenceIds = model.cards.flatMap(card => card.evidenceIds);
    expect(evidenceIds.length).toBeLessThanOrEqual(3);
    expect(new Set(evidenceIds).size).toBe(evidenceIds.length);
    expect(model.cards.flatMap(card => card.advice)).toHaveLength(3);
  });

});
