import capabilityAudit from '../../docs/superpowers/reports/workbench-stage0-capabilities.json';

type CriterionStatus =
  | 'implemented-verified'
  | 'implemented-unverified'
  | 'designed'
  | 'absent';

interface CapabilityCriterion {
  criterionId: string;
  points: number;
  status: CriterionStatus;
  codeEvidence: string[];
  testEvidence: string[];
  sampleEvidence: string[];
  limitations: string[];
}

interface CapabilityRecord {
  capabilityId: string;
  domain: string;
  points: number;
  scoreEligible: boolean;
  criteria: CapabilityCriterion[];
}

const records = capabilityAudit.records as CapabilityRecord[];

describe('Stage 6 capability audit contract', () => {
  it('freezes every score-eligible record into evidence-bearing atomic criteria', () => {
    for (const record of records) {
      expect(record.criteria).toBeDefined();
      expect(record.criteria.reduce((sum, criterion) => sum + criterion.points, 0))
        .toBe(record.points);
      expect(new Set(record.criteria.map(criterion => criterion.criterionId)).size)
        .toBe(record.criteria.length);

      for (const criterion of record.criteria) {
        expect(criterion.criterionId.startsWith(`${record.capabilityId}-`)).toBe(true);
        expect(criterion.points).toBeGreaterThan(0);
        expect(criterion.limitations.length).toBeGreaterThan(0);
      }
    }
    const verifiedCriteria = records.flatMap(record => record.criteria)
      .filter(criterion => criterion.status === 'implemented-verified');
    for (const criterion of verifiedCriteria) {
      expect(criterion.codeEvidence.length).toBeGreaterThan(0);
      expect(criterion.testEvidence.length + criterion.sampleEvidence.length)
        .toBeGreaterThan(0);
    }
  });

  it('derives earned points from verified criteria without changing the 100 point model', () => {
    const scoreEligible = records.filter(record => record.scoreEligible);
    const available = scoreEligible.reduce((sum, record) => sum + record.points, 0);
    const earned = scoreEligible.flatMap(record => record.criteria)
      .filter(criterion => criterion.status === 'implemented-verified')
      .reduce((sum, criterion) => sum + criterion.points, 0);

    expect(available).toBe(100);
    expect(earned).toBeGreaterThan(0);
    expect(earned).toBeLessThanOrEqual(available);
  });
});
