import type { CorrelationCandidate } from '../../workbench/crossSourceProtocol';
import { buildCrossSourceDiagnosisFindings } from './crossSourceDiagnosis';

const candidate: CorrelationCandidate = {
  correlationId: 'correlation:1',
  entityIds: ['trace:request:1', 'netlog:request:1'],
  confidence: 'high',
  score: 1,
  matchedFields: ['request-id', 'method'],
  conflictingFields: [],
  alignmentId: 'alignment:1',
  uncertaintyUs: 0,
  evidenceIds: ['trace:event:1', 'netlog:request:1'],
  limitations: [],
  allowsDuration: true,
  allowsDiagnosisUpgrade: true,
};

describe('buildCrossSourceDiagnosisFindings', () => {
  it('requires a high conflict-free correlation and phase-specific NetLog evidence', () => {
    const findings = buildCrossSourceDiagnosisFindings({
      candidates: [candidate],
      connectionPaths: [{
        entityId: 'netlog:request:1',
        phases: [{ phase: 'dns', evidenceIds: ['netlog:request:1:dns'] }],
      }],
    });

    expect(findings).toEqual([
      expect.objectContaining({
        phase: 'dns',
        entityIds: candidate.entityIds,
        evidenceIds: expect.arrayContaining(['netlog:request:1:dns']),
      }),
    ]);
    expect(findings[0].limitations.join(' ')).toContain('不等于');
  });

  it.each(['medium', 'low', 'unavailable'] as const)(
    'does not upgrade a %s candidate',
    confidence => {
      expect(buildCrossSourceDiagnosisFindings({
        candidates: [{ ...candidate, confidence, allowsDiagnosisUpgrade: false }],
        connectionPaths: [{
          entityId: 'netlog:request:1',
          phases: [{ phase: 'tls', evidenceIds: ['netlog:request:1:tls'] }],
        }],
      })).toEqual([]);
    },
  );

  it('does not infer a connection cause without explicit phase evidence', () => {
    expect(buildCrossSourceDiagnosisFindings({
      candidates: [candidate],
      connectionPaths: [],
    })).toEqual([]);
  });
});
