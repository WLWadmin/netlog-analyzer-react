#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const reportDir = process.env.WORKBENCH_STAGE1_REPORT_DIR
  ? path.resolve(process.env.WORKBENCH_STAGE1_REPORT_DIR)
  : path.join(root, 'docs/superpowers/reports');
const sourcePath = path.join(reportDir, 'workbench-stage1-evidence.json');
const outputPath = path.join(reportDir, 'workbench-stage1-evidence.md');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const allowedStates = new Set(source.allowedStates);
const eventCounts = [100000, 500000, 1000000];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, keys, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} schema drift: ${actual.join(',')}`);
}

function assertNumber(value, label) {
  assert(Number.isFinite(value) && value >= 0, `${label} must be a non-negative number`);
}

function percentile(samples, ratio) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function validateTiming(summary, label, runCount) {
  assertExactKeys(summary, ['samplesMs', 'p50Ms', 'p95Ms'], label);
  assert(Array.isArray(summary.samplesMs) && summary.samplesMs.length === runCount, `${label} sample count differs`);
  summary.samplesMs.forEach((sample, index) => assertNumber(sample, `${label}[${index}]`));
  assert(Math.abs(summary.p50Ms - percentile(summary.samplesMs, 0.5)) < 0.001, `${label} P50 differs`);
  assert(Math.abs(summary.p95Ms - percentile(summary.samplesMs, 0.95)) < 0.001, `${label} P95 differs`);
}

function benchmarkPath(eventCount) {
  const suffix = eventCount === 1000000 ? '1000k' : `${eventCount / 1000}k`;
  return path.join(reportDir, `workbench-stage1-browser-${suffix}.json`);
}

function validateBenchmark(eventCount) {
  const artifactPath = benchmarkPath(eventCount);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const label = path.basename(artifactPath);
  assertExactKeys(artifact, [
    'schemaVersion',
    'status',
    'codeRef',
    'environment',
    'corpus',
    'runs',
    'timings',
    'transfer',
    'memory',
    'cancellation',
    'queue',
    'release',
    'safety',
  ], label);
  assert(artifact.schemaVersion === 1, `${label} schemaVersion differs`);
  assert(artifact.status === 'browser-benchmark-verified', `${label} status differs`);
  assert(typeof artifact.codeRef === 'string' && artifact.codeRef.length > 0, `${label} lacks codeRef`);
  assert(artifact.codeRef.startsWith(source.baseRef), `${label} does not identify the stage 1 base ref`);
  assertExactKeys(artifact.environment, [
    'browserUserAgent',
    'operatingSystem',
    'cpu',
    'memory',
    'dpr',
  ], `${label}.environment`);
  assert(typeof artifact.environment.browserUserAgent === 'string' && artifact.environment.browserUserAgent.length > 0, `${label} lacks browser user agent`);
  assert(typeof artifact.environment.operatingSystem === 'string' && artifact.environment.operatingSystem.length > 0, `${label} lacks operating system`);
  assertExactKeys(artifact.environment.cpu, ['model', 'logicalCores', 'limitation'], `${label}.environment.cpu`);
  assert(artifact.environment.cpu.model === null || typeof artifact.environment.cpu.model === 'string', `${label} has invalid CPU model`);
  assertNumber(artifact.environment.cpu.logicalCores, `${label}.environment.cpu.logicalCores`);
  assert(typeof artifact.environment.cpu.limitation === 'string', `${label} lacks CPU limitation`);
  assertExactKeys(artifact.environment.memory, ['deviceGiB', 'limitation'], `${label}.environment.memory`);
  assert(artifact.environment.memory.deviceGiB === null || Number.isFinite(artifact.environment.memory.deviceGiB), `${label} has invalid device memory`);
  assert(typeof artifact.environment.memory.limitation === 'string', `${label} lacks memory limitation`);
  assertNumber(artifact.environment.dpr, `${label}.environment.dpr`);
  assertExactKeys(artifact.corpus, [
    'sourceBytes',
    'jsonBytes',
    'eventCount',
    'eventFamilyDistribution',
    'screenshotEncodedBytes',
    'screenshotDecodedBytes',
    'fileReadMs',
    'jsonParseMs',
    'indexBuildMs',
    'sampleHash',
  ], `${label}.corpus`);
  assert(artifact.corpus.eventCount === eventCount, `${label} eventCount differs`);
  assert(
    artifact.corpus.eventFamilyDistribution
      && Object.values(artifact.corpus.eventFamilyDistribution).every(Number.isInteger),
    `${label} has invalid event family distribution`,
  );
  assert(
    Object.values(artifact.corpus.eventFamilyDistribution)
      .reduce((sum, count) => sum + count, 0) === eventCount,
    `${label} event family count differs`,
  );
  for (const field of [
    'sourceBytes',
    'jsonBytes',
    'screenshotEncodedBytes',
    'screenshotDecodedBytes',
    'fileReadMs',
    'jsonParseMs',
    'indexBuildMs',
  ]) {
    assertNumber(artifact.corpus[field], `${label}.corpus.${field}`);
  }
  assert(/^[a-f0-9]{64}$/.test(artifact.corpus.sampleHash), `${label} sampleHash is invalid`);
  assert(artifact.runs.warmupCount === 3, `${label} warmupCount differs`);
  assert(artifact.runs.validRunCount === 10, `${label} validRunCount differs`);
  for (const timing of [
    'viewportQuery',
    'viewportWorker',
    'selectionQuery',
    'canvasDraw',
    'zoom',
    'pan',
    'hover',
  ]) {
    validateTiming(artifact.timings[timing], `${label}.${timing}`, artifact.runs.validRunCount);
  }
  assertNumber(artifact.timings.firstInteractiveMs, `${label}.firstInteractiveMs`);
  assertNumber(artifact.timings.cancellationResponseMs, `${label}.cancellationResponseMs`);
  assertNumber(artifact.timings.totalBenchmarkMs, `${label}.totalBenchmarkMs`);
  assert(artifact.timings.zoom.p95Ms <= 50, `${label} zoom P95 exceeds 50ms`);
  assert(artifact.timings.pan.p95Ms <= 50, `${label} pan P95 exceeds 50ms`);
  assert(artifact.timings.hover.p95Ms <= 100, `${label} hover P95 exceeds 100ms`);
  assert(artifact.timings.selectionQuery.p95Ms <= 300, `${label} selection P95 exceeds 300ms`);
  assert(artifact.timings.cancellationResponseMs <= 500, `${label} cancellation exceeds 500ms`);
  assert(artifact.queue.maxQueueDepth <= 2, `${label} queue exceeds two`);
  assert(artifact.queue.cancelledRequestCount === 1, `${label} repeated active cancellation`);
  assert(artifact.queue.droppedPendingRequestCount >= 1, `${label} did not exercise latest-wins`);
  assert(Number.isInteger(artifact.queue.discardedLateResponseCount) && artifact.queue.discardedLateResponseCount >= 0, `${label} has invalid discarded response count`);
  assert(artifact.cancellation.controlResponseType === 'query-cancelled', `${label} lacks cancellation acknowledgement`);
  assert(artifact.cancellation.queryResponseType === 'structured-error', `${label} lacks cancelled query result`);
  assert(artifact.cancellation.queryErrorCode === 'query-cancelled', `${label} has invalid cancellation error`);
  assert(artifact.release.responseType === 'session-released', `${label} release response differs`);
  assert(artifact.safety.maxJsonBytes === 128 * 1024 * 1024, `${label} JSON limit differs`);
  assert(artifact.safety.limitRaised === false, `${label} raised JSON limit`);
  assert(artifact.safety.rawTraceEventsReturnedToUi === false, `${label} exposed raw events`);
  assertNumber(artifact.transfer.workerUiBytes, `${label}.transfer.workerUiBytes`);
  assert(artifact.memory.uiPeakBytes === null || Number.isFinite(artifact.memory.uiPeakBytes), `${label} UI memory is invalid`);
  assert(
    artifact.memory.workerPeakBytes === null || Number.isFinite(artifact.memory.workerPeakBytes),
    `${label} worker memory is invalid`,
  );
  return artifact;
}

assertExactKeys(source, [
  'schemaVersion',
  'reviewDate',
  'baseRef',
  'allowedStates',
  'releaseAccepted',
  'realSampleGate',
  'workerMemoryGate',
  'batches',
], 'stage1 evidence');
assert(source.schemaVersion === 1, 'stage1 evidence schemaVersion differs');
assert(source.releaseAccepted === false, 'release acceptance cannot be inferred');
assert(source.realSampleGate.state === 'real-sample-blocked', 'real sample state must remain blocked');
const realSampleArtifact = JSON.parse(fs.readFileSync(
  path.join(root, source.realSampleGate.artifact),
  'utf8',
));
assert(realSampleArtifact.gatePassed === false, 'real sample artifact unexpectedly passed');
assert(source.workerMemoryGate.measured === false, 'worker memory must not be marked measured');
assert(Array.isArray(source.batches) && source.batches.length === 6, 'six batches are required');

for (const batch of source.batches) {
  assertExactKeys(batch, [
    'batchId',
    'title',
    'states',
    'codeEvidence',
    'testEvidence',
    'browserEvidence',
    'limitations',
  ], batch.batchId ?? 'batch');
  assert(/^BATCH-(7|8|9|10|11|12)$/.test(batch.batchId), `${batch.batchId} is invalid`);
  assert(Array.isArray(batch.states) && batch.states.every(state => allowedStates.has(state)), `${batch.batchId} has invalid state`);
  assert(batch.states.includes('implemented'), `${batch.batchId} is not implemented`);
  assert(!batch.states.includes('release-accepted'), `${batch.batchId} falsely claims release acceptance`);
  assert(batch.states.includes('real-sample-blocked'), `${batch.batchId} omits real sample blocking`);
  assert(Array.isArray(batch.codeEvidence) && batch.codeEvidence.length > 0, `${batch.batchId} lacks code evidence`);
  assert(Array.isArray(batch.testEvidence), `${batch.batchId} lacks test evidence`);
  assert(Array.isArray(batch.browserEvidence), `${batch.batchId} lacks browser evidence`);
  assert(Array.isArray(batch.limitations) && batch.limitations.length > 0, `${batch.batchId} lacks limitations`);
  if (batch.states.includes('automated-verified')) {
    assert(batch.testEvidence.length > 0, `${batch.batchId} lacks automated evidence`);
  }
  if (batch.states.includes('browser-benchmark-verified')) {
    assert(batch.browserEvidence.length > 0, `${batch.batchId} lacks browser evidence`);
  }
}

const benchmarks = eventCounts.map(validateBenchmark);
assert(new Set(benchmarks.map(item => item.codeRef)).size === 1, 'benchmark code refs differ');
const lines = [
  '# Performance Workbench 阶段 1 证据',
  '',
  `- 基础 ref：\`${source.baseRef}\``,
  `- 复核日期：${source.reviewDate}`,
  '- 发布验收：未接受',
  `- 真实样本：\`${source.realSampleGate.state}\``,
  `- Worker 独立峰值内存：${source.workerMemoryGate.measured ? '已测量' : '未测量'}`,
  '',
  '| Batch | 状态 | 代码证据 | 自动化证据 | 浏览器证据 | 限制 |',
  '|---|---|---|---|---|---|',
  ...source.batches.map(batch => (
    `| ${batch.batchId} ${batch.title} | ${batch.states.map(state => `\`${state}\``).join('<br>')} | ${batch.codeEvidence.map(item => `\`${item}\``).join('<br>')} | ${batch.testEvidence.map(item => `\`${item}\``).join('<br>') || '无'} | ${batch.browserEvidence.map(item => `\`${item}\``).join('<br>') || '无'} | ${batch.limitations.join('<br>')} |`
  )),
  '',
  '## 浏览器指标',
  '',
  '| 事件数 | JSON bytes | 首次可交互 | 视口 P95 | 选区 P95 | 缩放 P95 | 平移 P95 | 悬浮 P95 | 取消 | 队列 |',
  '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...benchmarks.map(item => (
    `| ${item.corpus.eventCount.toLocaleString('en-US')} | ${item.corpus.jsonBytes.toLocaleString('en-US')} | ${item.timings.firstInteractiveMs.toFixed(1)} ms | ${item.timings.viewportQuery.p95Ms.toFixed(1)} ms | ${item.timings.selectionQuery.p95Ms.toFixed(1)} ms | ${item.timings.zoom.p95Ms.toFixed(1)} ms | ${item.timings.pan.p95Ms.toFixed(1)} ms | ${item.timings.hover.p95Ms.toFixed(1)} ms | ${item.timings.cancellationResponseMs.toFixed(1)} ms | ${item.queue.maxQueueDepth} |`
  )),
  '',
  '浏览器 smoke、自动化测试和构建均不能替代仓库外真实样本或发布验收。',
  '',
];
fs.writeFileSync(outputPath, lines.join('\n'));
console.log(JSON.stringify({
  output: path.relative(root, outputPath),
  batches: source.batches.length,
  benchmarkEventCounts: eventCounts,
  releaseAccepted: source.releaseAccepted,
  realSampleState: source.realSampleGate.state,
}));
