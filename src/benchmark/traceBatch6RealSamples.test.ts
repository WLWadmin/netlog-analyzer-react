import fs from 'fs';
import path from 'path';
import { ReadableStream as NodeReadableStream } from 'stream/web';
import { TextDecoder as NodeTextDecoder } from 'util';
import { gunzipSync } from 'zlib';
import { findSensitiveDataLeaks } from '../diagnosis/shared/maskedExport';
import type { TraceAnalysisResult } from '../diagnosis/trace';
import {
  buildTraceJsonExport,
  buildTraceMarkdownReport,
} from '../parsers/trace/exportTraceReport';
import { MinimalTraceAggregator } from '../parsers/trace/minimalTraceAggregator';
import { readTraceFileForWorker } from '../parsers/trace/readTraceFile';
import { TRACE_LIMITS } from '../parsers/trace/traceLimits';
import { buildTraceAnalysisResult } from '../workers/buildTraceAnalysisResult';

type ExpectedCapability =
  | 'navigation-context'
  | 'page-milestones'
  | 'network-lifecycle'
  | 'network-initiators'
  | 'renderer-tasks'
  | 'multi-process-attribution'
  | 'interactions'
  | 'rendering-frames';

interface SampleManifestEntry {
  id: `TRACE-SAMPLE-0${1 | 2 | 3 | 4 | 5}`;
  inputRef: string;
  positiveCapabilities: ExpectedCapability[];
}

interface SampleManifest {
  schemaVersion: 1;
  samples: SampleManifestEntry[];
}

interface RunEvidence {
  signature: string;
  readMs: number;
  aggregateMs: number;
  diagnoseAndExportMs: number;
  totalMs: number;
  eventCount: number;
  jsonBytes: number;
  heapDeltaBytes: number;
}

const MANIFEST_PATH = process.env.TRACE_SAMPLE_MANIFEST_PATH;
const shouldRun = Boolean(MANIFEST_PATH);

jest.setTimeout(15 * 60 * 1000);

beforeAll(() => {
  Object.defineProperty(global, 'ReadableStream', {
    configurable: true,
    value: NodeReadableStream,
  });
  Object.defineProperty(global, 'TextDecoder', {
    configurable: true,
    value: NodeTextDecoder,
  });
});

function readManifest(manifestPath: string): SampleManifest {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SampleManifest;
  expect(parsed.schemaVersion).toBe(1);
  expect(parsed.samples.map(sample => sample.id)).toEqual([
    'TRACE-SAMPLE-01',
    'TRACE-SAMPLE-02',
    'TRACE-SAMPLE-03',
    'TRACE-SAMPLE-04',
    'TRACE-SAMPLE-05',
  ]);
  expect(new Set(parsed.samples.map(sample => sample.inputRef)).size).toBe(5);
  return parsed;
}

function resolveExternalSample(
  manifestPath: string,
  sample: SampleManifestEntry,
): { bytes: Buffer; gzip: boolean } {
  const samplePath = path.resolve(path.dirname(manifestPath), sample.inputRef);
  const relativeToWorktree = path.relative(process.cwd(), samplePath);
  expect(relativeToWorktree.startsWith('..')).toBe(true);
  const stat = fs.statSync(samplePath);
  expect(stat.isFile()).toBe(true);
  expect(stat.size).toBeLessThanOrEqual(TRACE_LIMITS.maxJsonBytes);
  const bytes = fs.readFileSync(samplePath);
  return {
    bytes,
    gzip: bytes[0] === 0x1f && bytes[1] === 0x8b,
  };
}

function capabilityAvailable(
  result: TraceAnalysisResult,
  capability: ExpectedCapability,
): boolean {
  const context = result.context;
  switch (capability) {
    case 'navigation-context':
      return context.navigations.length > 0;
    case 'page-milestones':
      return (context.milestones?.length ?? 0) > 0;
    case 'network-lifecycle':
      return (context.requests?.length ?? 0) > 0;
    case 'network-initiators':
      return (context.requests ?? []).some(request => (
        request.initiatorEvidenceIds.length > 0
        || request.initiatorRequestId !== undefined
      ));
    case 'renderer-tasks':
      return (context.tasks?.length ?? 0) > 0;
    case 'multi-process-attribution':
      return [...context.frames, ...context.navigations].some(item => (
        new Set(item.processSpans.map(span => span.processId)).size > 1
      ));
    case 'interactions':
      return (context.interactions?.length ?? 0) > 0;
    case 'rendering-frames':
      return (context.animationFrames?.length ?? 0) > 0
        && (context.rendering?.length ?? 0) > 0;
  }
}

function stableSignature(result: TraceAnalysisResult): string {
  const context = result.context;
  return JSON.stringify({
    intake: {
      encoding: result.intake.encoding,
      jsonBytes: result.intake.jsonBytes,
      eventCount: result.intake.eventCount,
      availableFamilies: result.intake.availableFamilies,
    },
    quality: context.quality,
    factCounts: context.factCounts,
    contextCounts: {
      processes: context.processes.length,
      threads: context.threads.length,
      frames: context.frames.length,
      navigations: context.navigations.length,
      requests: context.requests?.length ?? 0,
      tasks: context.tasks?.length ?? 0,
      milestones: context.milestones?.length ?? 0,
      animationFrames: context.animationFrames?.length ?? 0,
      rendering: context.rendering?.length ?? 0,
      interactions: context.interactions?.length ?? 0,
    },
    frameAttribution: context.frames.map(frame => ({
      frameId: frame.frameId,
      processSpans: frame.processSpans,
    })),
    navigationAttribution: context.navigations.map(navigation => ({
      key: navigation.key,
      processSpans: navigation.processSpans,
    })),
    diagnoses: result.diagnosis.diagnoses.map(diagnosis => ({
      id: diagnosis.id,
      ruleId: diagnosis.ruleId,
      score: diagnosis.score,
      confidence: diagnosis.confidence,
      evidenceIds: diagnosis.evidenceIds,
    })),
  });
}

async function runSample(
  sample: SampleManifestEntry,
  bytes: Buffer,
  gzip: boolean,
): Promise<RunEvidence> {
  const heapBefore = process.memoryUsage().heapUsed;
  const totalStartedAt = Date.now();
  const readStartedAt = Date.now();
  const file = new File([bytes], `${sample.id}${gzip ? '.trace.gz' : '.trace'}`);
  const outcome = await readTraceFileForWorker(file, {
    ...(gzip
      ? {
          decompress: () => new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(gunzipSync(bytes)));
              controller.close();
            },
          }),
        }
      : {}),
  });
  const readMs = Date.now() - readStartedAt;
  expect(outcome.kind).toBe('trace');
  if (outcome.kind !== 'trace') throw new Error(`${sample.id} 未识别为 Trace`);

  const aggregateStartedAt = Date.now();
  const aggregated = await new MinimalTraceAggregator({
    encoding: outcome.intake.encoding,
    jsonBytes: outcome.intake.jsonBytes,
    skippedEventCount: outcome.skippedEventCount,
    warnings: outcome.intake.warnings,
  }).aggregate(outcome.trace, {
    isCancelled: () => false,
    onProgress: () => undefined,
  });
  const aggregateMs = Date.now() - aggregateStartedAt;

  const diagnoseStartedAt = Date.now();
  const result = buildTraceAnalysisResult(aggregated.facts);
  const missingCapabilities = sample.positiveCapabilities.filter(capability => (
    !capabilityAvailable(result, capability)
  ));
  expect({
    sampleId: sample.id,
    missingCapabilities,
  }).toEqual({
    sampleId: sample.id,
    missingCapabilities: [],
  });
  const jsonReport = JSON.stringify(buildTraceJsonExport(result));
  const markdownReport = buildTraceMarkdownReport(result);
  expect(findSensitiveDataLeaks(jsonReport)).toEqual([]);
  expect(findSensitiveDataLeaks(markdownReport)).toEqual([]);
  const diagnoseAndExportMs = Date.now() - diagnoseStartedAt;

  return {
    signature: stableSignature(result),
    readMs,
    aggregateMs,
    diagnoseAndExportMs,
    totalMs: Date.now() - totalStartedAt,
    eventCount: outcome.intake.eventCount,
    jsonBytes: outcome.intake.jsonBytes,
    heapDeltaBytes: Math.max(0, process.memoryUsage().heapUsed - heapBefore),
  };
}

if (!shouldRun) {
  describe.skip('Trace Batch 6 脱敏真实样本门禁（未注入样本）', () => {
    it('需要通过 TRACE_SAMPLE_MANIFEST_PATH 注入仓库外匿名样本', () => undefined);
  });
} else {
  describe('Trace Batch 6 脱敏真实样本门禁', () => {
    const manifestPath = path.resolve(MANIFEST_PATH as string);
    const manifest = readManifest(manifestPath);

    it.each(manifest.samples)('$id 能力、三次稳定性、容量和导出隐私通过', async sample => {
      const { bytes, gzip } = resolveExternalSample(manifestPath, sample);
      expect(bytes.byteLength).toBeLessThanOrEqual(
        gzip ? TRACE_LIMITS.maxCompressedBytes : TRACE_LIMITS.maxJsonBytes,
      );

      const runs: RunEvidence[] = [];
      for (let runIndex = 0; runIndex < 3; runIndex += 1) {
        runs.push(await runSample(sample, bytes, gzip));
      }

      expect(new Set(runs.map(run => run.signature)).size).toBe(1);
      console.info('[trace-batch6-evidence]', {
        sampleId: sample.id,
        encoding: gzip ? 'gzip-json' : 'plain-json',
        sourceBytes: bytes.byteLength,
        jsonBytes: runs[0].jsonBytes,
        eventCount: runs[0].eventCount,
        runCount: runs.length,
        totalMs: runs.map(run => run.totalMs),
        readMs: runs.map(run => run.readMs),
        aggregateMs: runs.map(run => run.aggregateMs),
        diagnoseAndExportMs: runs.map(run => run.diagnoseAndExportMs),
        heapDeltaBytes: runs.map(run => run.heapDeltaBytes),
      });
    });
  });
}
