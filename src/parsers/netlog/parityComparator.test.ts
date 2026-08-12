import {
  buildNetlogParitySignature,
  compareNetlogParitySignatures,
  hashNetlogParityValue,
} from './parityComparator';
import { parseLog } from './parser';
import { createNetlogStreamingAnalyzer } from './streamingAnalyzer';

interface RawEvent {
  time: string;
  type: number;
  phase: number;
  source: { id: number; type: number };
  params: Record<string, unknown>;
}

function requestLifecycleFixture() {
  const events: RawEvent[] = [{
    time: '100',
    type: 111,
    phase: 0,
    source: { id: 10, type: 1 },
    params: {
      url: 'https://parity.example.invalid/api?token=SECRET_VALUE',
      method: 'GET',
    },
  }];
  for (let index = 0; index < 35; index += 1) {
    events.push({
      time: String(110 + index),
      type: 1,
      phase: 2,
      source: { id: 10, type: 1 },
      params: { byte_count: index + 1 },
    });
  }
  events.push({
    time: '200',
    type: 181,
    phase: 2,
    source: { id: 10, type: 1 },
    params: {
      status_code: 200,
      headers: 'HTTP/2 200\r\nx-response-cinfo: 203.0.113.10\r\n',
    },
  });
  events.push({
    time: '4200',
    type: 2,
    phase: 1,
    source: { id: 10, type: 1 },
    params: {},
  });
  return {
    constants: { timeTickOffset: 1_741_095_022_562 },
    events,
  };
}

function currentStreamingCandidate(logData: ReturnType<typeof requestLifecycleFixture>) {
  const analyzer = createNetlogStreamingAnalyzer({
    constants: logData.constants,
  });
  logData.events.forEach(event => analyzer.accept(event));
  const { result, eventsPreview } = analyzer.finish();
  return { result, events: eventsPreview };
}

describe('NetLog full-vs-stream parity comparator', () => {
  it('freezes a legacy-compatible fixture signature without exposing source text', () => {
    const full = parseLog(requestLifecycleFixture());
    const signature = buildNetlogParitySignature(full);
    const serialized = JSON.stringify(signature);

    expect(hashNetlogParityValue(signature)).toBe('fnv1a32:3073fb80');
    expect(serialized).not.toContain('SECRET_VALUE');
    expect(serialized).not.toContain('parity.example.invalid');
  });

  it('fingerprints optional undefined values deterministically', () => {
    expect(hashNetlogParityValue(undefined)).toBe(hashNetlogParityValue(undefined));
    expect(hashNetlogParityValue(undefined)).not.toBe(hashNetlogParityValue('undefined'));
  });

  it('matches the migrated full parser for request lifecycle diagnostics', () => {
    const fixture = requestLifecycleFixture();
    const fullSignature = buildNetlogParitySignature(parseLog(fixture));
    const streamSignature = buildNetlogParitySignature(
      currentStreamingCandidate(fixture),
    );

    expect(compareNetlogParitySignatures(fullSignature, streamSignature)).toBeNull();
  });

  it('reports only sanitized signature values in mismatch context', () => {
    const difference = compareNetlogParitySignatures(
      { urlHash: hashNetlogParityValue('https://safe.invalid/?token=SECRET') },
      { urlHash: hashNetlogParityValue('https://safe.invalid/?token=OTHER') },
    );

    expect(difference?.path).toBe('$.urlHash');
    expect(JSON.stringify(difference)).not.toContain('SECRET');
    expect(JSON.stringify(difference)).not.toContain('safe.invalid');
  });

  it('covers Dataset count, query rows, source chains, detail, and byte ranges', () => {
    const full = parseLog(requestLifecycleFixture());
    const baseDataset = {
      eventCount: 38,
      queries: [{
        key: 'all:first-page',
        total: 38,
        rows: [{
          eventId: 0,
          typeId: 111,
          sourceId: 10,
          sourceTypeId: 1,
          phase: 0,
          hasError: false,
          byteStart: 128,
          byteEnd: 256,
        }],
      }],
      sourceChains: [{
        sourceId: 10,
        sourceIds: [10, 20],
        eventCount: 38,
      }],
      details: [{
        eventId: 0,
        byteStart: 128,
        byteEnd: 256,
        value: {
          type: 111,
          params: { url: 'https://detail.invalid/?token=SECRET_DETAIL' },
        },
      }],
    };
    const expected = buildNetlogParitySignature({
      ...full,
      dataset: baseDataset,
    });
    const actual = buildNetlogParitySignature({
      ...full,
      dataset: {
        ...baseDataset,
        details: [{
          ...baseDataset.details[0],
          byteEnd: 257,
        }],
      },
    });
    const difference = compareNetlogParitySignatures(expected, actual);

    expect(difference).toEqual({
      path: '$.dataset.details[0].byteEnd',
      expected: 256,
      actual: 257,
    });
    expect(JSON.stringify(expected)).not.toContain('SECRET_DETAIL');
    expect(JSON.stringify(expected)).not.toContain('detail.invalid');
  });
});
