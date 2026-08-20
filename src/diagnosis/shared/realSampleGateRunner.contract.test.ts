const {
  validArtifact,
}: {
  validArtifact: (value: unknown, expectedArea: string) => boolean;
} = require('../../../scripts/run-diagnosis-real-sample-gate');

export {};

describe('diagnosis real-sample gate runner artifact contract', () => {
  it('accepts a completed artifact with explicit facts and forbidden conclusions', () => {
    expect(validArtifact({
      area: 'combined',
      executed: true,
      passed: true,
      cases: [{
        id: 'paired-har-netlog',
        passed: true,
        expectedFacts: ['same reproduction window'],
        forbiddenConclusions: ['weak correlation upgraded to root cause'],
      }],
    }, 'combined')).toBe(true);
  });

  it('rejects empty, failed or mismatched artifacts', () => {
    expect(validArtifact({
      area: 'large-file',
      executed: true,
      passed: true,
      cases: [],
    }, 'large-file')).toBe(false);
    expect(validArtifact({
      area: 'acceptance',
      executed: true,
      passed: false,
      cases: [{ id: 'browser', passed: false, expectedFacts: [], forbiddenConclusions: [] }],
    }, 'acceptance')).toBe(false);
    expect(validArtifact({
      area: 'trace',
      executed: true,
      passed: true,
      cases: [{ id: 'trace', passed: true, expectedFacts: [], forbiddenConclusions: [] }],
    }, 'combined')).toBe(false);
  });
});
