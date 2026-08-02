import type { TimeAlignment } from '../../workbench/crossSourceProtocol';
import {
  correlateCrossSourceRequests,
  type CrossSourceRequestFact,
} from './crossSourceCorrelation';

const alignment: TimeAlignment = {
  alignmentId: 'alignment-1',
  sourceIds: ['trace:1', 'har:1', 'netlog:1'],
  anchorType: 'safe-request-key',
  offsetUs: 0,
  uncertaintyUs: 1_000,
  sampleCount: 3,
  conflicts: [],
  validRange: { startUs: 0, endUs: 10_000_000 },
  confidence: 'high',
  limitations: [],
};

function fact(
  source: CrossSourceRequestFact['source'],
  overrides: Partial<CrossSourceRequestFact> = {},
): CrossSourceRequestFact {
  return {
    entityId: `${source}:request:1`,
    sourceId: `${source}:1`,
    source,
    localRequestId: 'request-1',
    method: 'GET',
    origin: 'https://api.example.test',
    pathname: '/resource',
    navigationId: 'navigation-1',
    redirectIndex: 0,
    startUs: 1_000_000,
    evidenceIds: [`${source}:evidence:1`],
    limitations: [],
    ...overrides,
  };
}

describe('three-source request correlation', () => {
  it('builds a high three-source entity from direct IDs and consistent fields', () => {
    const result = correlateCrossSourceRequests({
      facts: [fact('trace'), fact('har'), fact('netlog')],
      alignments: [alignment],
    });

    expect(result.candidates[0]).toMatchObject({
      confidence: 'high',
      matchedFields: expect.arrayContaining([
        'request-id', 'safe-request-key', 'method', 'navigation', 'time-window',
      ]),
      conflictingFields: [],
      allowsDuration: true,
      allowsDiagnosisUpgrade: true,
    });
  });

  it.each([
    ['same URL concurrency', [
      fact('trace'),
      fact('har'),
      fact('har', { entityId: 'har:request:2', localRequestId: 'request-2', startUs: 1_000_100 }),
    ]],
    ['method conflict', [fact('trace'), fact('har', { method: 'POST' })]],
    ['navigation conflict', [fact('trace'), fact('netlog', { navigationId: 'navigation-2' })]],
    ['same host different path', [
      fact('trace'),
      fact('har', { localRequestId: 'request-2', pathname: '/other' }),
    ]],
  ])('does not upgrade %s to high', (_name, facts) => {
    const result = correlateCrossSourceRequests({
      facts: facts as CrossSourceRequestFact[],
      alignments: [alignment],
    });
    expect(result.candidates.every(candidate => (
      !candidate.allowsDiagnosisUpgrade || candidate.confidence === 'high'
    ))).toBe(true);
    expect(result.candidates.some(candidate => candidate.confidence !== 'high')).toBe(true);
  });

  it('keeps query values out while matching origin and pathname', () => {
    const result = correlateCrossSourceRequests({
      facts: [
        fact('trace', { queryPresent: true }),
        fact('har', { queryPresent: true }),
      ],
      alignments: [alignment],
    });
    const output = JSON.stringify(result);
    expect(result.entities[0].safeKey).toBe('GET https://api.example.test/resource');
    expect(output).not.toContain('?');
    expect(output).not.toContain('token');
  });

  it('keeps exact paths for matching but masks dynamic path identifiers in DTOs', () => {
    const result = correlateCrossSourceRequests({
      facts: [
        fact('trace', { pathname: '/users/123456789/account' }),
        fact('har', { pathname: '/users/123456789/account' }),
      ],
      alignments: [alignment],
    });

    expect(result.candidates[0]).toMatchObject({
      confidence: 'high',
      matchedFields: expect.arrayContaining(['safe-request-key']),
    });
    expect(result.entities[0].safeKey)
      .toBe('GET https://api.example.test/users/:id/account');
    expect(JSON.stringify(result)).not.toContain('123456789');
  });

  it('bounds projected request keys to the protocol string limit', () => {
    const pathname = `/${Array.from({ length: 100 }, () => 'public').join('/')}`;
    const result = correlateCrossSourceRequests({
      facts: [fact('trace', { pathname })],
      alignments: [],
    });

    expect(result.entities[0].safeKey)
      .toBe('GET https://api.example.test/[path-truncated]');
    expect(result.entities[0].safeKey!.length).toBeLessThanOrEqual(512);
  });

  it('models redirects, service worker, cache and preload as explicit fields', () => {
    const result = correlateCrossSourceRequests({
      facts: [
        fact('trace', {
          redirectIndex: 1,
          redirectFromEntityId: 'trace:request:0',
          deliveryType: 'service-worker',
        }),
        fact('har', {
          redirectIndex: 1,
          redirectFromEntityId: 'har:request:0',
          deliveryType: 'service-worker',
        }),
        fact('netlog', { redirectIndex: 1, deliveryType: 'preload' }),
      ],
      alignments: [alignment],
    });

    expect(result.candidates.some(candidate => (
      candidate.matchedFields.includes('redirect-index')
    ))).toBe(true);
    expect(result.candidates.some(candidate => (
      candidate.conflictingFields.includes('delivery-type')
    ))).toBe(true);
  });

  it('disables durations when alignment is unavailable and only emits explicit connection phases', () => {
    const result = correlateCrossSourceRequests({
      facts: [
        fact('trace'),
        fact('netlog', {
          connectionEvidence: {
            dnsEvidenceIds: ['netlog:event:dns'],
            tlsEvidenceIds: ['netlog:event:tls'],
          },
        }),
      ],
      alignments: [{ ...alignment, confidence: 'unavailable' }],
    });

    expect(result.candidates.every(candidate => !candidate.allowsDuration)).toBe(true);
    expect(result.connectionPaths).toEqual([{
      entityId: 'netlog:request:1',
      phases: [
        { phase: 'dns', evidenceIds: ['netlog:event:dns'] },
        { phase: 'tls', evidenceIds: ['netlog:event:tls'] },
      ],
    }]);
  });

  it('uses only an alignment that directly covers the candidate source pair', () => {
    const result = correlateCrossSourceRequests({
      facts: [fact('trace'), fact('netlog')],
      alignments: [{
        ...alignment,
        sourceIds: ['trace:1', 'har:1'],
      }],
    });

    expect(result.candidates[0]).toMatchObject({
      confidence: 'medium',
      allowsDuration: false,
      allowsDiagnosisUpgrade: false,
    });
    expect(result.candidates[0].alignmentId).toBeUndefined();
  });

  it('treats mismatched safe request keys as a conflict even with a direct ID', () => {
    const result = correlateCrossSourceRequests({
      facts: [fact('trace'), fact('har', { pathname: '/other' })],
      alignments: [alignment],
    });

    expect(result.candidates[0]).toMatchObject({
      confidence: 'low',
      conflictingFields: expect.arrayContaining(['safe-request-key']),
      allowsDiagnosisUpgrade: false,
    });
  });

  it('detects same-key ambiguity on either side of the pair', () => {
    const result = correlateCrossSourceRequests({
      facts: [
        fact('trace'),
        fact('trace', {
          entityId: 'trace:request:2',
          localRequestId: 'request-2',
        }),
        fact('har'),
      ],
      alignments: [alignment],
    });

    expect(result.candidates.every(candidate => candidate.confidence !== 'high')).toBe(true);
  });

  it('does not use coincident raw timestamps outside the alignment valid range', () => {
    const result = correlateCrossSourceRequests({
      facts: [
        fact('trace', { startUs: 20_000_000 }),
        fact('har', { startUs: 20_000_000 }),
      ],
      alignments: [alignment],
    });

    expect(result.candidates[0]).toMatchObject({
      confidence: 'medium',
      allowsDuration: false,
      allowsDiagnosisUpgrade: false,
    });
    expect(result.candidates[0].matchedFields).not.toContain('time-window');
  });
});
