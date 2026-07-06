#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const file = argValue('--file');
const label = argValue('--label') || 'manual';

if (!file) {
  console.error('Usage: npm run benchmark:netlog-worker -- --file /path/to/chrome-net-export-log.json --label real-326mb');
  process.exit(1);
}

const absoluteFile = path.resolve(file);
if (!fs.existsSync(absoluteFile)) {
  console.error(`File not found: ${absoluteFile}`);
  process.exit(1);
}

const tempTestPath = path.join(__dirname, '..', 'src', 'workers', 'netlogWorkerBenchmark.tmp.test.ts');
const marker = 'NETLOG_WORKER_BENCHMARK ';
const escapedFile = JSON.stringify(absoluteFile);
const escapedLabel = JSON.stringify(label);

const testSource = `
import { Readable } from 'stream';
import { TextDecoder, TextEncoder } from 'util';
import { buildNetlogCompactEventIndex, readNetlogEventDetail, type NetlogIndexableFile } from './netlogDatasetIndexer';
import { queryNetlogEvents } from './netlogDatasetQuery';

jest.setTimeout(15 * 60_000);
(global as any).TextDecoder = TextDecoder;
(global as any).TextEncoder = TextEncoder;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function readSlice(filePath: string, start = 0, end?: number): Blob {
  const stat = require('fs').statSync(filePath);
  const safeEnd = Math.min(end ?? stat.size, stat.size);
  const length = Math.max(0, safeEnd - start);
  const buffer = Buffer.alloc(length);
  const fd = require('fs').openSync(filePath, 'r');
  try {
    require('fs').readSync(fd, buffer, 0, length, start);
  } finally {
    require('fs').closeSync(fd);
  }
  return { text: async () => buffer.toString('utf8') } as Blob;
}

describe('netlog worker benchmark', () => {
  it('reports Dataset index/query/detail metrics', async () => {
    const fs = require('fs') as typeof import('fs');
    const filePath = ${escapedFile};
    const stat = fs.statSync(filePath);
    const file: NetlogIndexableFile = {
      name: require('path').basename(filePath),
      size: stat.size,
      stream: () => Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>,
      slice: (start?: number, end?: number) => readSlice(filePath, start, end),
    };

    const startedAt = Date.now();
    const result = await buildNetlogCompactEventIndex(file);
    const datasetIndexMs = Date.now() - startedAt;
    const index = result.index;
    const queryTimes: number[] = [];
    const detailTimes: number[] = [];
    const analysisId = 'benchmark';
    const sampleSourceId = index.sourceId.find(id => id > 0);
    const sampleSourceChainId = index.sourceDependencyFrom?.find(id => id > 0) || sampleSourceId;
    const sampleTypeId = index.typeId.find(id => id > 0);
    const queries = [
      { analysisId, page: 1, pageSize: 100 },
      { analysisId, page: 10, pageSize: 100 },
      { analysisId, errorOnly: true, page: 1, pageSize: 100 },
      sampleSourceId ? { analysisId, sourceId: sampleSourceId, page: 1, pageSize: 100 } : { analysisId, page: 1, pageSize: 100 },
      sampleSourceChainId ? { analysisId, sourceChainId: sampleSourceChainId, page: 1, pageSize: 100 } : { analysisId, page: 1, pageSize: 100 },
      sampleTypeId ? { analysisId, typeId: sampleTypeId, page: 1, pageSize: 100 } : { analysisId, page: 1, pageSize: 100 },
    ];
    for (const query of queries) {
      const t0 = Date.now();
      queryNetlogEvents(index, query);
      queryTimes.push(Date.now() - t0);
    }
    const detailIds = [0, Math.floor(index.count / 2), Math.max(0, index.count - 1)].filter((id, i, arr) => id >= 0 && id < index.count && arr.indexOf(id) === i);
    for (const eventId of detailIds) {
      const t0 = Date.now();
      await readNetlogEventDetail(file, index, eventId);
      detailTimes.push(Date.now() - t0);
    }

    const endpointEvidence = result.endpointEvidence;
    const metrics = {
      benchmark: 'netlog-worker-dataset-baseline',
      runtime: 'jest-node-indexer',
      label: ${escapedLabel},
      fileName: file.name,
      fileSize: file.size,
      summaryScanMs: 0,
      summaryParsedEvents: 0,
      datasetIndexMs,
      datasetEventCount: index.count,
      lightweightParseSkippedEvents: result.parseSkipStats.lightweightParseSkippedEvents,
      lightweightParseSkippedBytes: result.parseSkipStats.lightweightParseSkippedBytes,
      lightweightParseSkipRate: index.count ? Math.round((result.parseSkipStats.lightweightParseSkippedEvents / index.count) * 10000) / 10000 : 0,
      socketLazyProbeAttemptedEvents: result.socketsState.lazyParamsStats.probeAttemptedEvents,
      socketLazyProbeSatisfiedEvents: result.socketsState.lazyParamsStats.probeSatisfiedEvents,
      socketLazyFallbackParamEvents: result.socketsState.lazyParamsStats.fallbackParamEvents,
      socketLazyProbeSatisfiedRate: result.socketsState.lazyParamsStats.probeAttemptedEvents
        ? Math.round((result.socketsState.lazyParamsStats.probeSatisfiedEvents / result.socketsState.lazyParamsStats.probeAttemptedEvents) * 10000) / 10000
        : 0,
      queryP50: percentile(queryTimes, 50),
      queryP95: percentile(queryTimes, 95),
      detailP50: percentile(detailTimes, 50),
      detailP95: percentile(detailTimes, 95),
      mainThreadBlockedMs: null,
      memoryPeakEstimateMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      endpointEvidenceCount: endpointEvidence.failedOrSlowIps.length,
      endpointRowCount: endpointEvidence.cipSipRows.length,
      dnsAnswerCount: endpointEvidence.dnsAnswers.length,
      socketPeerCount: endpointEvidence.failedOrSlowIps.filter(item => item.role === 'socket-peer').length,
      serverObservedClientIpCount: endpointEvidence.failedOrSlowIps.filter(item => item.role === 'server-observed-client-ip').length,
      sourceGraphAssociatedCount: endpointEvidence.failedOrSlowIps.filter(item => item.association === 'source-graph').length,
      globalCandidateCount: endpointEvidence.failedOrSlowIps.filter(item => item.association === 'global-candidate').length,
      socketPeerTotal: endpointEvidence.sourceGraphStats?.socketPeerTotal,
      socketPeerSourceGraphAssociated: endpointEvidence.sourceGraphStats?.socketPeerSourceGraphAssociated,
      socketPeerGlobalCandidate: endpointEvidence.sourceGraphStats?.socketPeerGlobalCandidate,
      sourceDependencyEdges: endpointEvidence.sourceGraphStats?.sourceDependencyEdges,
      sourceDependencyUnparsed: endpointEvidence.sourceGraphStats?.sourceDependencyUnparsed,
      globalCandidateByTypeName: endpointEvidence.sourceGraphStats?.globalCandidateByTypeName,
      globalCandidateBySourceTypeName: endpointEvidence.sourceGraphStats?.globalCandidateBySourceTypeName,
      globalCandidateParamKeys: endpointEvidence.sourceGraphStats?.globalCandidateParamKeys,
      sourceGraphDepthHit: endpointEvidence.sourceGraphStats?.sourceGraphDepthHit,
      sourceGraphUnresolvedReasons: endpointEvidence.sourceGraphStats?.sourceGraphUnresolvedReasons,
      dnsAnswerCandidateCount: endpointEvidence.dnsAnswerSourceStats?.candidateCount,
      dnsAnswerUniqueHostIpPairs: endpointEvidence.dnsAnswerSourceStats?.uniqueHostIpPairs,
      dnsAnswerMissingTraceCount: endpointEvidence.dnsAnswerSourceStats?.missingTraceCount,
      dnsAnswerBySourceKind: endpointEvidence.dnsAnswerSourceStats?.bySourceKind,
      dnsAnswerByTypeName: endpointEvidence.dnsAnswerSourceStats?.byTypeName,
      errors: [],
      notes: ['mainThreadBlockedMs 需要浏览器 PerformanceObserver 才能测量；此命令只作为 Dataset index/query/detail baseline。'],
    };
    console.log(${JSON.stringify(marker)} + JSON.stringify(metrics));
    expect(index.count).toBeGreaterThan(0);
  });
});
`;

try {
  fs.writeFileSync(tempTestPath, testSource);
  const reactScripts = path.join(__dirname, '..', 'node_modules', 'react-scripts', 'bin', 'react-scripts.js');
  const result = spawnSync(process.execPath, [reactScripts, 'test', '--watchAll=false', '--runTestsByPath', tempTestPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, CI: 'true' },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const line = output.split(/\r?\n/).find(item => item.includes(marker));
  if (!line) {
    process.stderr.write(output);
    process.exitCode = result.status || 1;
  } else {
    const jsonStart = line.indexOf(marker) + marker.length;
    console.log(JSON.stringify(JSON.parse(line.slice(jsonStart)), null, 2));
    process.exitCode = result.status || 0;
  }
} finally {
  if (fs.existsSync(tempTestPath)) {
    fs.unlinkSync(tempTestPath);
  }
}
