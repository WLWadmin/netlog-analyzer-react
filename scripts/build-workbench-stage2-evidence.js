#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const reportDir = process.env.WORKBENCH_STAGE2_REPORT_DIR
  ? path.resolve(process.env.WORKBENCH_STAGE2_REPORT_DIR)
  : path.join(root, 'docs/superpowers/reports');
const source = readJson('workbench-stage2-evidence.json');
const eventCounts = [100_000, 500_000, 1_000_000];

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(reportDir, file), 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} schema drift: ${actual.join(',')}`);
}

function number(value, label) {
  assert(Number.isFinite(value) && value >= 0, `${label} must be a non-negative number`);
}

function percentile(samples, ratio) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function validateTiming(value, label, expectedCount = 10) {
  exactKeys(value, ['samplesMs', 'p50Ms', 'p95Ms'], label);
  assert(Array.isArray(value.samplesMs), `${label}.samplesMs must be an array`);
  if (expectedCount === null) {
    assert(value.samplesMs.length > 0, `${label} needs at least one sample`);
  } else {
    assert(value.samplesMs.length === expectedCount, `${label} sample count differs`);
  }
  value.samplesMs.forEach((sample, index) => number(sample, `${label}[${index}]`));
  assert(Math.abs(value.p50Ms - percentile(value.samplesMs, 0.5)) < 0.001, `${label} P50 differs`);
  assert(Math.abs(value.p95Ms - percentile(value.samplesMs, 0.95)) < 0.001, `${label} P95 differs`);
}

function benchmarkFile(eventCount) {
  const suffix = eventCount === 1_000_000 ? '1000k' : `${eventCount / 1_000}k`;
  return `workbench-stage2-browser-${suffix}.json`;
}

function validateRunner(runner, label) {
  exactKeys(runner, ['kind', 'command', 'playwright', 'componentMounts'], `${label}.runner`);
  assert(runner.kind === 'repository-cdp-product-components', `${label} did not use the product runner`);
  assert(runner.command === 'node scripts/run-workbench-stage2-browser.js', `${label} command differs`);
  assert(runner.playwright === false, `${label} falsely claims Playwright`);
  exactKeys(runner.componentMounts, [
    'TraceTimelineWorkbench',
    'TimelineCanvas',
    'ScreenshotFilmstrip',
    'TimelineInteractionStore',
  ], `${label}.componentMounts`);
  assert(Object.values(runner.componentMounts).every(Boolean), `${label} did not mount every product component`);
}

function validateChecks(value, label) {
  assert(value && typeof value === 'object', `${label} must be an object`);
  for (const [name, passed] of Object.entries(value)) {
    assert(passed === true, `${label}.${name} failed`);
  }
}

function validateBenchmark(eventCount) {
  const file = benchmarkFile(eventCount);
  const artifact = readJson(file);
  exactKeys(artifact, [
    'schemaVersion', 'status', 'codeRef', 'workingTreeDiffHash', 'runner',
    'environment', 'corpus', 'runs', 'timings', 'interactions', 'responsive',
    'themes', 'accessibility', 'transfer', 'memory', 'queue', 'resources',
    'safety', 'consoleErrors',
  ], file);
  assert(artifact.schemaVersion === 2, `${file} must use schema v2`);
  assert(artifact.status === 'browser-benchmark-verified', `${file} is not verified`);
  assert(artifact.codeRef.startsWith(source.baseRef), `${file} codeRef differs`);
  assert(/^[a-f0-9]{64}$/.test(artifact.workingTreeDiffHash), `${file} diff hash is invalid`);
  validateRunner(artifact.runner, file);
  exactKeys(artifact.environment, [
    'browserUserAgent', 'operatingSystem', 'cpuLogicalCores', 'deviceMemoryGiB', 'dpr',
  ], `${file}.environment`);
  assert(typeof artifact.environment.browserUserAgent === 'string', `${file} browser is missing`);
  assert(typeof artifact.environment.operatingSystem === 'string', `${file} OS is missing`);
  number(artifact.environment.dpr, `${file}.dpr`);
  assert(artifact.corpus.eventCount === eventCount, `${file} eventCount differs`);
  assert(
    Object.values(artifact.corpus.eventFamilyDistribution)
      .reduce((sum, count) => sum + count, 0) === eventCount,
    `${file} event families differ`,
  );
  for (const field of [
    'sourceBytes', 'jsonBytes', 'screenshotEncodedBytes', 'screenshotDecodedBytes',
    'fileReadMs', 'jsonParseMs', 'indexBuildMs',
  ]) number(artifact.corpus[field], `${file}.corpus.${field}`);
  assert(/^[a-f0-9]{64}$/.test(artifact.corpus.sampleHash), `${file} sample hash is invalid`);
  exactKeys(artifact.runs, ['warmupCount', 'validRunCount'], `${file}.runs`);
  assert(artifact.runs.warmupCount === 5 && artifact.runs.validRunCount === 10, `${file} run counts differ`);
  exactKeys(artifact.timings, [
    'viewportQuery', 'selectionQuery', 'canvasDraw', 'zoom', 'pan', 'hover',
    'cancellationResponse',
  ], `${file}.timings`);
  for (const field of [
    'viewportQuery', 'selectionQuery', 'canvasDraw', 'zoom', 'pan', 'hover',
  ]) validateTiming(artifact.timings[field], `${file}.${field}`);
  validateTiming(artifact.timings.cancellationResponse, `${file}.cancellationResponse`, null);
  assert(artifact.timings.zoom.p95Ms <= 50, `${file} zoom P95 exceeds 50ms`);
  assert(artifact.timings.pan.p95Ms <= 50, `${file} pan P95 exceeds 50ms`);
  assert(artifact.timings.hover.p95Ms <= 100, `${file} hover P95 exceeds 100ms`);
  assert(artifact.timings.selectionQuery.p95Ms <= 300, `${file} selection P95 exceeds 300ms`);
  assert(artifact.timings.cancellationResponse.p95Ms <= 500, `${file} cancellation exceeds 500ms`);
  validateChecks(artifact.interactions, `${file}.interactions`);
  for (const width of ['1280', '1100', '900']) {
    assert(artifact.responsive[width]?.passed === true, `${file} viewport ${width} failed`);
    assert(artifact.responsive[width].horizontalOverflow === false, `${file} viewport ${width} overflowed`);
  }
  validateChecks(artifact.themes, `${file}.themes`);
  validateChecks(artifact.accessibility, `${file}.accessibility`);
  number(artifact.transfer.workerUiBytes, `${file}.transfer.workerUiBytes`);
  assert(artifact.memory.workerPeakBytes === null, `${file} falsely reports Worker memory`);
  assert(typeof artifact.memory.limitation === 'string', `${file} memory limitation is missing`);
  for (const channel of ['viewport', 'selection']) {
    assert(artifact.queue[channel].maxQueueDepth <= 2, `${file} ${channel} queue exceeds two`);
  }
  assert(
    artifact.queue.viewport.cancelledRequestCount
      + artifact.queue.selection.cancelledRequestCount > 0,
    `${file} did not exercise cancellation`,
  );
  assert(artifact.resources.blobUrlsCreated > 0, `${file} did not create a screenshot URL`);
  assert(
    artifact.resources.blobUrlsRevoked >= artifact.resources.blobUrlsCreated,
    `${file} leaked screenshot URLs`,
  );
  assert(artifact.resources.sessionClosed === true, `${file} did not close the session`);
  assert(artifact.resources.canvasRemoved === true, `${file} retained the Canvas`);
  assert(artifact.safety.maxJsonBytes === 128 * 1024 * 1024, `${file} JSON limit differs`);
  assert(artifact.safety.limitRaised === false, `${file} raised the JSON limit`);
  assert(artifact.safety.rawTraceEventsReturnedToUi === false, `${file} exposed raw events`);
  assert(Array.isArray(artifact.consoleErrors) && artifact.consoleErrors.length === 0, `${file} has console errors`);
  return artifact;
}

exactKeys(source, [
  'schemaVersion', 'reviewDate', 'baseRef', 'designSource', 'allowedStates',
  'releaseAccepted', 'realSampleGate', 'workerMemoryGate', 'playwrightGate', 'batches',
], 'stage2 evidence');
assert(source.schemaVersion === 1, 'stage2 evidence schemaVersion differs');
assert(source.releaseAccepted === false, 'release acceptance cannot be inferred');
assert(source.designSource.integratedInBaseRef === false, 'design integration gate must remain open');
assert(source.realSampleGate.state === 'real-sample-blocked', 'real samples must remain blocked');
assert(source.workerMemoryGate.measured === false, 'Worker memory must remain unmeasured');
assert(source.playwrightGate.installed === false, 'Playwright must not be claimed installed');
const realSamples = JSON.parse(fs.readFileSync(path.join(root, source.realSampleGate.artifact), 'utf8'));
assert(realSamples.gatePassed === false, 'real sample artifact unexpectedly passed');
assert(Array.isArray(source.batches) && source.batches.length === 7, 'seven batches are required');
const allowedStates = new Set(source.allowedStates);
for (const batch of source.batches) {
  exactKeys(batch, [
    'batchId', 'title', 'states', 'codeEvidence', 'testEvidence',
    'browserEvidence', 'limitations',
  ], batch.batchId);
  assert(/^BATCH-(13|14|15|16|17|18|19)$/.test(batch.batchId), `${batch.batchId} is invalid`);
  assert(batch.states.every(state => allowedStates.has(state)), `${batch.batchId} has invalid state`);
  assert(batch.states.includes('implemented'), `${batch.batchId} is not implemented`);
  assert(batch.states.includes('automated-verified'), `${batch.batchId} lacks automated verification`);
  assert(batch.states.includes('real-sample-blocked'), `${batch.batchId} omits real sample blocking`);
  assert(!batch.states.includes('release-accepted'), `${batch.batchId} falsely claims release acceptance`);
  if (batch.states.includes('browser-benchmark-verified')) {
    assert(batch.browserEvidence.length > 0, `${batch.batchId} lacks browser evidence`);
  }
  assert(batch.codeEvidence.length > 0 && batch.testEvidence.length > 0, `${batch.batchId} lacks evidence`);
  assert(batch.limitations.length > 0, `${batch.batchId} lacks limitations`);
}

const benchmarks = eventCounts.map(validateBenchmark);
const ui = readJson('workbench-stage2-ui-validation.json');
exactKeys(ui, [
  'schemaVersion', 'status', 'codeRef', 'workingTreeDiffHash', 'runner',
  'browserUserAgent', 'sampleHash', 'viewports', 'interactions',
  'accessibility', 'themes', 'resources', 'consoleErrors',
], 'stage2 UI validation');
assert(ui.schemaVersion === 2 && ui.status === 'browser-benchmark-verified', 'UI validation is not schema v2 verified');
assert(ui.codeRef.startsWith(source.baseRef), 'UI validation codeRef differs');
assert(ui.workingTreeDiffHash === benchmarks[0].workingTreeDiffHash, 'UI validation diff hash differs');
assert(ui.sampleHash === benchmarks[0].corpus.sampleHash, 'UI validation sample hash differs');
validateRunner(ui.runner, 'stage2 UI validation');
for (const width of ['1280', '1100', '900']) {
  assert(ui.viewports[width]?.passed === true, `UI viewport ${width} failed`);
  assert(ui.viewports[width].horizontalOverflow === false, `UI viewport ${width} overflowed`);
}
validateChecks(ui.interactions, 'UI interactions');
validateChecks(ui.accessibility, 'UI accessibility');
validateChecks(ui.themes, 'UI themes');
assert(ui.resources.blobUrlsRevoked >= ui.resources.blobUrlsCreated, 'UI leaked Blob URLs');
assert(ui.resources.sessionClosed && ui.resources.canvasRemoved, 'UI resources were not released');
assert(Array.isArray(ui.consoleErrors) && ui.consoleErrors.length === 0, 'UI console errors exist');

const outputPath = path.join(reportDir, 'workbench-stage2-evidence.md');
const lines = [
  '# Performance Workbench 阶段 2 证据',
  '',
  `- 代码基线：\`${source.baseRef}\``,
  `- Working-tree diff hash：\`${benchmarks[0].workingTreeDiffHash}\``,
  `- 浏览器 runner：\`${benchmarks[0].runner.command}\`（CDP，非 Playwright）`,
  `- V5 设计进入代码 ref：${source.designSource.integratedInBaseRef ? '是' : '否'}`,
  `- 真实样本：\`${source.realSampleGate.state}\``,
  `- Worker 独立峰值内存：${source.workerMemoryGate.measured ? '已测量' : '未测量'}`,
  `- 发布验收：${source.releaseAccepted ? '已接受' : '未接受'}`,
  '',
  '| Batch | 状态 | 代码证据 | 自动化证据 | 浏览器证据 | 限制 |',
  '|---|---|---|---|---|---|',
  ...source.batches.map(batch => (
    `| ${batch.batchId} ${batch.title} | ${batch.states.map(state => `\`${state}\``).join('<br>')} | ${batch.codeEvidence.map(item => `\`${item}\``).join('<br>')} | ${batch.testEvidence.map(item => `\`${item}\``).join('<br>')} | ${batch.browserEvidence.map(item => `\`${item}\``).join('<br>') || '无'} | ${batch.limitations.join('<br>')} |`
  )),
  '',
  '## 产品组件浏览器指标',
  '',
  '| 事件数 | JSON bytes | 视口 P95 | 选区 P95 | Canvas P95 | 缩放 P95 | 平移 P95 | 悬浮 P95 | 取消 P95 |',
  '|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...benchmarks.map(item => (
    `| ${item.corpus.eventCount.toLocaleString('en-US')} | ${item.corpus.jsonBytes.toLocaleString('en-US')} | ${item.timings.viewportQuery.p95Ms.toFixed(1)} ms | ${item.timings.selectionQuery.p95Ms.toFixed(1)} ms | ${item.timings.canvasDraw.p95Ms.toFixed(1)} ms | ${item.timings.zoom.p95Ms.toFixed(1)} ms | ${item.timings.pan.p95Ms.toFixed(1)} ms | ${item.timings.hover.p95Ms.toFixed(1)} ms | ${item.timings.cancellationResponse.p95Ms.toFixed(1)} ms |`
  )),
  '',
  '自动测试、合成产品组件 benchmark 和本地 UI 验证均不能替代仓库外真实样本或发布验收。',
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
