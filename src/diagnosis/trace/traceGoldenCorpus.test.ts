import { TRACE_GOLDEN_CORPUS_IDS, buildTraceGoldenCorpus } from './traceGoldenCorpus';

describe('Trace Golden Corpus expectations', () => {
  it('keeps the approved 17 scenarios and an explicit complete expectation per case', () => {
    const corpus = buildTraceGoldenCorpus();
    expect(corpus.map(item => item.id)).toEqual(TRACE_GOLDEN_CORPUS_IDS);
    expect(corpus).toHaveLength(17);

    for (const item of corpus) {
      expect(item.expectation).toEqual(expect.objectContaining({
        requiredRules: expect.any(Array),
        forbiddenRules: expect.any(Array),
        factAssertions: expect.any(Array),
      }));
      for (const rule of item.expectation.requiredRules) {
        expect(rule).toEqual(expect.objectContaining({
          ruleId: expect.any(String),
          status: expect.stringMatching(/^(matched|not-matched|disabled)$/),
          confidence: expect.objectContaining({ min: expect.any(String), max: expect.any(String) }),
          category: expect.anything(),
          evidence: expect.stringMatching(/^(required|forbidden|ignored)$/),
          limitations: expect.any(Array),
          disabledReason: expect.anything(),
        }));
      }
      expect(item.runs).toHaveLength(3);
    }
  });

  it('declares the required and forbidden rules for every approved scenario', () => {
    const byId = new Map(buildTraceGoldenCorpus().map(item => [item.id, item.expectation]));
    expect(byId.get('404/500')?.requiredRules.map(item => item.ruleId)).toContain('N1');
    expect(byId.get('404/500')?.forbiddenRules).toEqual(expect.arrayContaining(['N2']));
    expect(byId.get('failed无response')?.requiredRules.map(item => item.ruleId)).toContain('N2');
    expect(byId.get('完整N3')?.requiredRules.map(item => item.ruleId)).toContain('N3');
    expect(byId.get('缺timing')?.requiredRules).toContainEqual(expect.objectContaining({
      ruleId: 'N3', status: 'disabled', disabledReason: 'TIMING_DOMAIN_UNCALIBRATED',
    }));
    expect(byId.get('截断/缺evidence')?.requiredRules).toContainEqual(expect.objectContaining({
      ruleId: 'N1', status: 'disabled', disabledReason: 'EVIDENCE_MISSING',
    }));
  });


  it('routes synthetic token, query and local path facts through the real M2 rule and builder', () => {
    const item = buildTraceGoldenCorpus().find(candidate => candidate.id === '敏感泄漏')!;
    const rawPath = item.context.cpuHotspots?.[0].script?.pathname;
    expect(rawPath).toContain('/Users/example/private');
    expect(rawPath).toContain('token=FAKE_TOKEN_VALUE');
    expect(rawPath).toContain('query=private');
    for (const run of item.runs) {
      const diagnosis = run.diagnoses.find(candidate => candidate.ruleId === 'M2');
      expect(diagnosis).toBeDefined();
      const output = JSON.stringify(diagnosis);
      expect(output).not.toContain('FAKE_TOKEN_VALUE');
      expect(output).not.toContain('query=private');
      expect(output).not.toContain('/Users/example/private');
      expect(output).toContain('[local path masked]');
    }
  });

  it('produces identical full diagnosis output in all three runs', () => {
    for (const item of buildTraceGoldenCorpus()) {
      expect(item.runs[1]).toEqual(item.runs[0]);
      expect(item.runs[2]).toEqual(item.runs[0]);
    }
  });
});
