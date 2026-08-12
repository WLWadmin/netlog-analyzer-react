import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  buildNetlogParitySignature,
  compareNetlogParitySignatures,
} from './parityComparator';
import { parseLog } from './parser';
import {
  createNetlogStreamingAnalyzer,
  type NetlogStreamingMetadata,
} from './streamingAnalyzer';
import { netlogEventIdentity } from './stableFingerprint';

const SAMPLE_NAMES = [
  'edge-net-export-log1.json',
  'chrome-net-export-log(1).json',
  'edge-net-export-log.json',
  'chrome-net-export-log.json',
] as const;

function requestedSampleNames(): readonly string[] {
  const configured = process.env.NETLOG_PARITY_SAMPLE_NAMES
    ?.split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return configured && configured.length > 0 ? configured : SAMPLE_NAMES;
}

interface RawNetlog extends NetlogStreamingMetadata {
  events: unknown[];
}

function requireRawNetlog(value: unknown): RawNetlog {
  if (
    value === null
    || typeof value !== 'object'
    || !Array.isArray((value as { events?: unknown }).events)
  ) {
    throw new Error('Parity sample is not a NetLog root with an events array');
  }
  return value as RawNetlog;
}

function streamingCandidate(input: RawNetlog) {
  const analyzer = createNetlogStreamingAnalyzer();
  analyzer.applyMetadata(input);
  input.events.forEach(event => analyzer.accept(event));
  const { result, eventsPreview } = analyzer.finish();
  return { result, events: eventsPreview };
}

function requestSequenceDetail(
  full: ReturnType<typeof parseLog>,
  candidate: ReturnType<typeof streamingCandidate>,
  differencePath: string | undefined,
) {
  const match = differencePath?.match(/^\$\.requests\[(\d+)\]\.eventSequenceHash$/);
  if (!match) return null;
  const index = Number(match[1]);
  const fullRequest = [...full.result.urlRequests].sort((left, right) => left.id - right.id)[index];
  const candidateRequest = [...candidate.result.urlRequests].sort((left, right) => left.id - right.id)[index];
  if (!fullRequest || !candidateRequest) return null;
  const previewLength = Math.min(fullRequest.events.length, candidateRequest.events.length);
  let previewDifference = null;
  for (let eventIndex = 0; eventIndex < previewLength; eventIndex += 1) {
    const expected = netlogEventIdentity(fullRequest.events[eventIndex]);
    const actual = netlogEventIdentity(candidateRequest.events[eventIndex]);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      previewDifference = { eventIndex, expected, actual };
      break;
    }
  }
  return {
    requestId: fullRequest.id,
    expectedCount: fullRequest.eventCount ?? fullRequest.events.length,
    actualCount: candidateRequest.eventCount ?? candidateRequest.events.length,
    previewDifference,
  };
}

function cardKeys(signature: unknown): string[] {
  const cards = (
    signature as {
      diagnosis?: {
        cards?: Array<{ category?: string; semanticId?: string }>;
      };
    }
  ).diagnosis?.cards || [];
  return cards.map(card => `${card.category || 'unknown'}:${card.semanticId || 'missing'}`);
}

function cardDifferenceDetail(signature: unknown, differencePath: string | undefined) {
  const match = differencePath?.match(/^\$\.diagnosis\.cards\[(\d+)\]/);
  if (!match) return null;
  return (
    signature as {
      diagnosis?: {
        cards?: unknown[];
      };
    }
  ).diagnosis?.cards?.[Number(match[1])] ?? null;
}

function issueKeys(signature: unknown): string[] {
  const issues = (
    signature as {
      issues?: {
        errors?: Array<{ category?: string; severity?: string }>;
        warnings?: Array<{ category?: string; severity?: string }>;
        info?: Array<{ category?: string; severity?: string }>;
      };
    }
  ).issues;
  return (['errors', 'warnings', 'info'] as const).flatMap(kind => (
    (issues?.[kind] || []).map(issue => (
      `${kind}:${issue.category || 'unknown'}:${issue.severity || 'unknown'}`
    ))
  ));
}

function diagnosticStateDetail(output: ReturnType<typeof parseLog>) {
  const categoryCounts = Object.fromEntries(
    Object.entries(output.result.eventCategoryStats || {})
      .map(([category, stat]) => [category, stat.count]),
  );
  const contextCounts = (output.result.diagnosticContextEvents || []).reduce<
    Record<string, number>
  >((counts, event) => {
    counts[event.category] = (counts[event.category] || 0) + 1;
    return counts;
  }, {});
  return { categoryCounts, contextCounts };
}

const sampleDirectory = process.env.NETLOG_PARITY_SAMPLE_DIR;
const realSampleDescribe = sampleDirectory ? describe : describe.skip;

realSampleDescribe('NetLog real-sample parity characterization', () => {
  it('matches full and streaming analysis for every required real sample', () => {
    const availableSamples = requestedSampleNames().filter(name => (
      existsSync(path.join(sampleDirectory!, name))
    ));
    if (availableSamples.length === 0) {
      throw new Error('NETLOG_PARITY_SAMPLE_DIR contains none of the required sample names');
    }

    const differences = availableSamples.map(name => {
      const input = requireRawNetlog(JSON.parse(
        readFileSync(path.join(sampleDirectory!, name), 'utf8'),
      ));
      const fullOutput = parseLog(input);
      const candidateOutput = streamingCandidate(input);
      const full = buildNetlogParitySignature(
        fullOutput,
        { allowPreviewDifferences: true },
      );
      const candidate = buildNetlogParitySignature(
        candidateOutput,
        { allowPreviewDifferences: true },
      );
      const difference = compareNetlogParitySignatures(full, candidate);
      return {
        sample: name,
        differencePath: difference?.path ?? null,
        expected: difference?.expected ?? null,
        actual: difference?.actual ?? null,
        requestSequenceDetail: requestSequenceDetail(
          fullOutput,
          candidateOutput,
          difference?.path,
        ),
        diagnosisCardKeys: difference?.path.startsWith('$.diagnosis')
          ? {
              expected: cardKeys(full),
              actual: cardKeys(candidate),
            }
          : null,
        diagnosisCardDetail: difference?.path.startsWith('$.diagnosis')
          ? {
              expected: cardDifferenceDetail(full, difference.path),
              actual: cardDifferenceDetail(candidate, difference.path),
            }
          : null,
        diagnosticStateDetail: difference?.path.startsWith('$.diagnosis')
          ? {
              expected: diagnosticStateDetail(fullOutput),
              actual: diagnosticStateDetail(candidateOutput),
            }
          : null,
        issueKeys: difference?.path.startsWith('$.issues')
          ? {
              expected: issueKeys(full),
              actual: issueKeys(candidate),
            }
          : null,
      };
    });

    expect(differences).toEqual(availableSamples.map(sample => ({
      sample,
      differencePath: null,
      expected: null,
      actual: null,
      requestSequenceDetail: null,
      diagnosisCardKeys: null,
      diagnosisCardDetail: null,
      diagnosticStateDetail: null,
      issueKeys: null,
    })));
  }, 1_200_000);
});
