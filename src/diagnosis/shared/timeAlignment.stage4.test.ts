import {
  alignClockDomains,
  projectAlignedTimeUs,
  type AlignmentAnchor,
} from './timeAlignment';

function anchor(overrides: Partial<AlignmentAnchor> = {}): AlignmentAnchor {
  return {
    anchorId: 'anchor-1',
    type: 'safe-request-key',
    sourceTime: { value: 1_700_000_000_000, unit: 'ms' },
    traceTimeUs: 5_000_000,
    evidenceIds: ['har:request:1', 'trace:event:1'],
    ...overrides,
  };
}

describe('Stage 4 time alignment', () => {
  it('supports positive and negative offsets with explicit units', () => {
    const positive = alignClockDomains({
      alignmentId: 'positive',
      sourceIds: ['trace:1', 'har:1'],
      anchors: [anchor({
        sourceTime: { value: 1, unit: 'ms' },
        traceTimeUs: 2_000,
      })],
    });
    const negative = alignClockDomains({
      alignmentId: 'negative',
      sourceIds: ['trace:1', 'netlog:1'],
      anchors: [anchor({
        sourceTime: { value: 2_000, unit: 'us' },
        traceTimeUs: 1_000,
      })],
    });

    expect(positive.offsetUs).toBe(1_000);
    expect(negative.offsetUs).toBe(-1_000);
    expect(positive.confidence).toBe('medium');
  });

  it('raises confidence for consistent anchors and reports conflicts', () => {
    const consistent = alignClockDomains({
      alignmentId: 'consistent',
      sourceIds: ['trace:1', 'har:1'],
      anchors: [
        anchor({ anchorId: 'a', sourceTime: { value: 1, unit: 'ms' }, traceTimeUs: 3_000 }),
        anchor({ anchorId: 'b', sourceTime: { value: 2, unit: 'ms' }, traceTimeUs: 4_000 }),
      ],
    });
    const conflicting = alignClockDomains({
      alignmentId: 'conflict',
      sourceIds: ['trace:1', 'har:1'],
      anchors: [
        anchor({ anchorId: 'a', sourceTime: { value: 1, unit: 'ms' }, traceTimeUs: 3_000 }),
        anchor({ anchorId: 'b', sourceTime: { value: 2, unit: 'ms' }, traceTimeUs: 40_000 }),
      ],
      conflictThresholdUs: 5_000,
    });

    expect(consistent).toMatchObject({
      confidence: 'high',
      offsetUs: 2_000,
      sampleCount: 2,
      conflicts: [],
    });
    expect(conflicting.confidence).toBe('low');
    expect(conflicting.conflicts.length).toBeGreaterThan(0);
  });

  it('disables projection outside the valid range or without an origin', () => {
    const result = alignClockDomains({
      alignmentId: 'range',
      sourceIds: ['trace:1', 'netlog:1'],
      anchors: [
        anchor({ anchorId: 'a', sourceTime: { value: 1, unit: 'ms' }, traceTimeUs: 3_000 }),
        anchor({ anchorId: 'b', sourceTime: { value: 2, unit: 'ms' }, traceTimeUs: 4_000 }),
      ],
    });
    const unavailable = alignClockDomains({
      alignmentId: 'missing-origin',
      sourceIds: ['trace:1', 'netlog:1'],
      anchors: [],
      unavailableReason: 'NetLog time origin 缺失',
    });

    expect(projectAlignedTimeUs({ value: 1.5, unit: 'ms' }, result)).toBe(3_500);
    expect(projectAlignedTimeUs({ value: 9, unit: 'ms' }, result)).toBeUndefined();
    expect(unavailable).toMatchObject({
      confidence: 'unavailable',
      limitations: ['NetLog time origin 缺失'],
    });
  });

  it('does not infer a NetLog clock from anchors when its origin is missing', () => {
    const unavailable = alignClockDomains({
      alignmentId: 'missing-origin-with-anchor',
      sourceIds: ['trace:1', 'netlog:1'],
      anchors: [anchor({
        sourceTime: { value: 100, unit: 'ms' },
        traceTimeUs: 1_000,
      })],
      unavailableReason: 'NetLog time origin 缺失',
    });

    expect(unavailable.confidence).toBe('unavailable');
    expect(unavailable.sampleCount).toBe(0);
  });

  it('rejects non-finite values, overflow and unit mistakes', () => {
    const result = alignClockDomains({
      alignmentId: 'invalid',
      sourceIds: ['trace:1', 'har:1'],
      anchors: [
        anchor({ sourceTime: { value: Number.NaN, unit: 'ms' } }),
        anchor({ anchorId: 'overflow', sourceTime: { value: Number.MAX_VALUE, unit: 'ms' } }),
      ],
    });

    expect(result.confidence).toBe('unavailable');
    expect(result.sampleCount).toBe(0);
    expect(result.limitations).toContain('没有有限且单位明确的校时锚点。');
  });
});
