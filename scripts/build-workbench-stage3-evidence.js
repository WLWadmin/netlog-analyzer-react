#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const reportDir = path.resolve(process.env.WORKBENCH_STAGE3_REPORT_DIR
  ?? path.join(root, 'docs/superpowers/reports'));
const source = read('workbench-stage3-evidence.json');
const tasks = read('workbench-stage3-expert-tasks.json');
const eventCounts = [100_000, 500_000, 1_000_000];
const requiredComponents = [
  'TraceTimelineWorkbench', 'TimelineCanvas', 'ScreenshotFilmstrip',
  'TimelineInteractionStore', 'FlameChartCanvas', 'ExpertAnalysisDrawer',
  'CallTree', 'BottomUp', 'EventLog', 'Search',
];
const requiredInteractions = [
  'hoverVerified', 'brushSelectionVerified', 'detailOpenedByCanvas',
  'returnButtonVisible', 'filmstripOpened', 'filmstripDialogClosed',
  'flameChart', 'callTree', 'bottomUp', 'eventLog', 'search',
  'virtualized', 'diagnosisNavigation',
];

function read(file) {
  return JSON.parse(fs.readFileSync(path.join(reportDir, file), 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function percentile(samples, ratio) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function timing(value, label) {
  assert(Array.isArray(value?.samplesMs) && value.samplesMs.length > 0, `${label} samples missing`);
  assert(Math.abs(value.p50Ms - percentile(value.samplesMs, 0.5)) < 0.001, `${label} P50 differs`);
  assert(Math.abs(value.p95Ms - percentile(value.samplesMs, 0.95)) < 0.001, `${label} P95 differs`);
}

function benchmarkFile(eventCount) {
  return `workbench-stage3-browser-${eventCount === 1_000_000 ? '1000k' : `${eventCount / 1_000}k`}.json`;
}

assert(source.schemaVersion === 1, 'stage3 evidence schema differs');
assert(source.releaseAccepted === false, 'release acceptance cannot be inferred');
assert(source.realSampleGate.state === 'real-sample-blocked', 'real samples must remain blocked');
assert(source.workerMemoryGate.measured === false, 'Worker memory must remain unmeasured');
assert(source.precision.state === 'synthetic-corpus-verified', 'precision source must remain synthetic');
assert(source.precision.reviewedHighConfidenceFindings
  === source.precision.truePositives + source.precision.falsePositives, 'precision denominator differs');
assert(source.precision.precision
  === source.precision.truePositives / source.precision.reviewedHighConfidenceFindings, 'precision differs');
assert(source.precision.reviewedHighConfidenceFindings < 20, 'synthetic precision denominator limitation changed');
assert(Array.isArray(source.batches) && source.batches.length === 9, 'nine stage3 batches are required');
assert(source.batches.every(batch => !batch.states.includes('release-accepted')), 'batch claims release acceptance');

assert(tasks.schemaVersion === 1 && tasks.tasks.length === 12, 'twelve expert tasks are required');
assert(new Set(tasks.tasks.map(task => task.id)).size === 12, 'expert task IDs must be unique');
assert(tasks.tasks.every(task => tasks.allowedStates.includes(task.state)), 'expert task state is invalid');
assert(tasks.tasks.find(task => task.id === 11)?.state === 'stage4-blocked', 'Task 11 must remain stage4-blocked');
assert(tasks.tasks.find(task => task.id === 7)?.state === 'stage6-blocked', 'Task 7 must remain stage6-blocked');
assert(tasks.tasks.find(task => task.id === 9)?.state === 'stage6-blocked', 'Task 9 must remain stage6-blocked');
const closedTasks = tasks.tasks.filter(task => task.state === 'closed').length;
assert(closedTasks < 12, 'stage3 must not claim 12/12');

const benchmarks = eventCounts.map(eventCount => {
  const artifact = read(benchmarkFile(eventCount));
  assert(artifact.schemaVersion === 3, `${eventCount} schema differs`);
  assert(artifact.status === 'browser-benchmark-verified', `${eventCount} browser state differs`);
  assert(artifact.corpus.eventCount === eventCount, `${eventCount} corpus differs`);
  assert(artifact.runner.playwright === false, `${eventCount} falsely claims Playwright`);
  for (const component of requiredComponents) {
    assert(
      artifact.runner.componentMounts[component] === true,
      `${eventCount} did not mount ${component}`,
    );
  }
  for (const name of [
    'viewportQuery', 'selectionQuery', 'zoom', 'pan', 'hover',
    'flameChartQuery', 'callTreeQuery', 'bottomUpQuery', 'eventLogQuery',
    'searchQuery', 'flameChartInteraction', 'callTreeInteraction',
    'bottomUpInteraction', 'eventLogInteraction', 'searchInteraction',
    'cancellationResponse',
  ]) timing(artifact.timings[name], `${eventCount}.${name}`);
  assert(artifact.timings.zoom.p95Ms <= 50, `${eventCount} zoom P95 failed`);
  assert(artifact.timings.pan.p95Ms <= 50, `${eventCount} pan P95 failed`);
  assert(artifact.timings.hover.p95Ms <= 100, `${eventCount} hover P95 failed`);
  assert(artifact.timings.selectionQuery.p95Ms <= 300, `${eventCount} selection P95 failed`);
  assert(artifact.timings.cancellationResponse.p95Ms <= 500, `${eventCount} cancellation failed`);
  for (const value of Object.values(artifact.stage2Regression ?? {})) {
    assert(value.regressionRatio <= 0.1, `${eventCount} exceeds Stage 2 regression budget`);
  }
  for (const interaction of requiredInteractions) {
    assert(
      artifact.interactions[interaction] === true,
      `${eventCount} interaction ${interaction} failed`,
    );
  }
  assert(Object.values(artifact.responsive).every(value => value.passed && !value.horizontalOverflow), `${eventCount} responsive check failed`);
  assert(artifact.resources.blobUrlsRevoked >= artifact.resources.blobUrlsCreated, `${eventCount} Blob URL leak`);
  assert(artifact.resources.sessionClosed && artifact.resources.canvasRemoved, `${eventCount} session resources retained`);
  assert(artifact.memory.workerPeakBytes === null, `${eventCount} falsely reports Worker memory`);
  assert(artifact.safety.rawTraceEventsReturnedToUi === false, `${eventCount} exposed raw events`);
  assert(artifact.consoleErrors.length === 0, `${eventCount} console errors`);
  return artifact;
});
assert(new Set(benchmarks.map(item => item.corpus.sampleHash)).size === 3, 'sample hashes must differ');

const ui = read('workbench-stage3-ui-validation.json');
assert(ui.schemaVersion === 3, 'stage3 UI schema differs');
for (const interaction of requiredInteractions) {
  assert(ui.interactions[interaction] === true, `stage3 UI interaction ${interaction} failed`);
}
assert(ui.consoleErrors.length === 0, 'stage3 UI console errors');

const lines = [
  '# Performance Workbench 阶段 3 证据',
  '',
  `- 基线：\`${source.baseRef}\``,
  `- 浏览器 runner：\`${benchmarks[0].runner.command}\`（CDP，非 Playwright）`,
  `- 专家任务：${closedTasks} / 12 closed；阶段 3 完整验收：否`,
  `- 高置信诊断精确率：${source.precision.truePositives} TP / ${source.precision.falsePositives} FP = ${(source.precision.precision * 100).toFixed(1)}%（仅合成审核语料，分母 ${source.precision.reviewedHighConfidenceFindings}）`,
  `- 真实样本：\`${source.realSampleGate.state}\``,
  '- Worker 独立峰值内存：未测量',
  '- 发布验收：未接受',
  '',
  '| Batch | 状态 | 限制 |',
  '|---|---|---|',
  ...source.batches.map(batch => (
    `| ${batch.batchId} | ${batch.states.map(state => `\`${state}\``).join('<br>')} | ${batch.limitations.join('<br>')} |`
  )),
  '',
  '| 事件数 | Flame 查询 P95 | Call Tree P95 | Bottom-up P95 | Event Log P95 | Search P95 |',
  '|---:|---:|---:|---:|---:|---:|',
  ...benchmarks.map(item => (
    `| ${item.corpus.eventCount.toLocaleString('en-US')} | ${item.timings.flameChartQuery.p95Ms.toFixed(1)} ms | ${item.timings.callTreeQuery.p95Ms.toFixed(1)} ms | ${item.timings.bottomUpQuery.p95Ms.toFixed(1)} ms | ${item.timings.eventLogQuery.p95Ms.toFixed(1)} ms | ${item.timings.searchQuery.p95Ms.toFixed(1)} ms |`
  )),
  '',
  '自动测试、合成语料和本地 CDP benchmark 不替代真实样本、独立 Worker 内存测量或发布验收。',
  '',
];
fs.writeFileSync(path.join(reportDir, 'workbench-stage3-evidence.md'), lines.join('\n'));
console.log(JSON.stringify({
  output: 'docs/superpowers/reports/workbench-stage3-evidence.md',
  closedTasks,
  releaseAccepted: source.releaseAccepted,
  precisionSource: source.precision.state,
}));
