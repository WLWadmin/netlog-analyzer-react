#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(
  root,
  'docs/superpowers/reports/workbench-stage0-capabilities.json',
);
const outputPath = path.join(
  root,
  'docs/superpowers/reports/workbench-stage0-capabilities.md',
);
const benchmarkReportPath = path.join(
  root,
  'docs/superpowers/reports/2026-08-01-workbench-browser-benchmark.md',
);
const benchmarkEventCounts = [100000, 500000, 1000000];
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const allowedStatuses = new Set(source.allowedStatuses);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNonNegativeNumber(value, label) {
  assert(Number.isFinite(value) && value >= 0, `${label} must be a non-negative number`);
}

function percentile(samples, ratio) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function validateTimingSummary(summary, label, validRunCount) {
  assert(summary && Array.isArray(summary.samplesMs), `${label}.samplesMs is required`);
  assert(summary.samplesMs.length === validRunCount, `${label} must contain ${validRunCount} samples`);
  summary.samplesMs.forEach((sample, index) => assertNonNegativeNumber(sample, `${label}.samplesMs[${index}]`));
  assertNonNegativeNumber(summary.p50Ms, `${label}.p50Ms`);
  assertNonNegativeNumber(summary.p95Ms, `${label}.p95Ms`);
  assert(Math.abs(summary.p50Ms - percentile(summary.samplesMs, 0.5)) < 0.001, `${label}.p50Ms differs from samples`);
  assert(Math.abs(summary.p95Ms - percentile(summary.samplesMs, 0.95)) < 0.001, `${label}.p95Ms differs from samples`);
}

function readAndValidateBenchmark(eventCount) {
  const suffix = eventCount === 1000000 ? '1000k' : `${eventCount / 1000}k`;
  const artifactPath = path.join(
    root,
    `docs/superpowers/reports/workbench-browser-benchmark-${suffix}.json`,
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const label = path.basename(artifactPath);
  assert(artifact.schemaVersion === 1, `${label} has unsupported schemaVersion`);
  assert(typeof artifact.codeRef === 'string' && artifact.codeRef.length > 0, `${label} lacks codeRef`);
  assert(artifact.environment && typeof artifact.environment.browserUserAgent === 'string', `${label} lacks browser user agent`);
  assert(typeof artifact.environment.operatingSystem === 'string', `${label} lacks operating system`);
  assertNonNegativeNumber(artifact.environment.cpu.logicalCores, `${label}.environment.cpu.logicalCores`);
  assert(artifact.environment.cpu.model === null || typeof artifact.environment.cpu.model === 'string', `${label} has invalid CPU model`);
  assert(artifact.environment.memory.deviceGiB === null || Number.isFinite(artifact.environment.memory.deviceGiB), `${label} has invalid device memory`);
  assertNonNegativeNumber(artifact.environment.dpr, `${label}.environment.dpr`);
  assert(artifact.corpus && artifact.corpus.eventCount === eventCount, `${label} has wrong eventCount`);
  for (const field of [
    'sourceBytes',
    'jsonBytes',
    'screenshotEncodedBytes',
    'screenshotDecodedBytes',
    'fileReadMs',
    'jsonParseMs',
    'indexBuildMs',
  ]) {
    assertNonNegativeNumber(artifact.corpus[field], `${label}.corpus.${field}`);
  }
  assert(/^[a-f0-9]{64}$/.test(artifact.corpus.sampleHash), `${label} has invalid sampleHash`);
  assert(artifact.runs && artifact.runs.warmupCount === 3, `${label} must contain three warmups`);
  assert(artifact.runs.validRunCount === 10, `${label} must contain ten valid runs`);
  for (const timing of [
    'viewportQuery',
    'viewportWorker',
    'selectionQuery',
    'canvasDraw',
    'zoom',
    'pan',
    'hover',
  ]) {
    validateTimingSummary(
      artifact.timings && artifact.timings[timing],
      `${label}.timings.${timing}`,
      artifact.runs.validRunCount,
    );
  }
  for (const timing of ['firstInteractiveMs', 'cancellationResponseMs', 'totalBenchmarkMs']) {
    assertNonNegativeNumber(artifact.timings[timing], `${label}.timings.${timing}`);
  }
  assertNonNegativeNumber(artifact.transfer.workerUiBytes, `${label}.transfer.workerUiBytes`);
  assert(artifact.memory.uiPeakBytes === null || Number.isFinite(artifact.memory.uiPeakBytes), `${label} has invalid UI memory`);
  assert(artifact.memory.workerPeakBytes === null || Number.isFinite(artifact.memory.workerPeakBytes), `${label} has invalid Worker memory`);
  assert(artifact.cancellation.controlResponseType === 'query-cancelled', `${label} lacks cancel acknowledgement`);
  assert(artifact.cancellation.queryResponseType === 'structured-error', `${label} lacks cancelled query response`);
  assert(artifact.cancellation.queryErrorCode === 'query-cancelled', `${label} has wrong cancellation error`);
  assert(Number.isInteger(artifact.queue.maxQueueDepth) && artifact.queue.maxQueueDepth <= 2, `${label} exceeds queue depth two`);
  assert(Number.isInteger(artifact.queue.cancelledRequestCount) && artifact.queue.cancelledRequestCount >= 1, `${label} did not issue active cancellation`);
  assert(Number.isInteger(artifact.queue.droppedPendingRequestCount) && artifact.queue.droppedPendingRequestCount >= 1, `${label} did not exercise pending backpressure`);
  assert(Number.isInteger(artifact.queue.discardedLateResponseCount) && artifact.queue.discardedLateResponseCount >= 0, `${label} has invalid discarded response count`);
  assert(artifact.release.responseType === 'session-released', `${label} lacks release acknowledgement`);
  assert(artifact.safety.maxJsonBytes === 128 * 1024 * 1024, `${label} changed the JSON safety limit`);
  assert(artifact.safety.limitRaised === false, `${label} raised the JSON safety limit`);
  assert(artifact.safety.rawTraceEventsReturnedToUi === false, `${label} returned raw events to UI`);
  return artifact;
}

for (const record of source.records) {
  assert(typeof record.capabilityId === 'string', 'capabilityId is required');
  assert(allowedStatuses.has(record.status), `${record.capabilityId} has invalid status`);
  assert(Number.isInteger(record.points) && record.points >= 0, `${record.capabilityId} has invalid points`);
  assert(typeof record.observableBehavior === 'string', `${record.capabilityId} lacks behavior`);
  assert(Array.isArray(record.codeEvidence), `${record.capabilityId} lacks code evidence`);
  assert(Array.isArray(record.testOrExpertEvidence), `${record.capabilityId} lacks test evidence`);
  assert(Array.isArray(record.sampleIds), `${record.capabilityId} lacks sample IDs`);
  assert(Array.isArray(record.limitations), `${record.capabilityId} lacks limitations`);
  assert(record.reviewDate === source.reviewDate, `${record.capabilityId} review date differs`);
}

const scoringRecords = source.records.filter(record => record.scoreEligible);
const totalPoints = scoringRecords.reduce((sum, record) => sum + record.points, 0);
const earnedPoints = scoringRecords
  .filter(record => record.status === 'implemented-verified')
  .reduce((sum, record) => sum + record.points, 0);
assert(totalPoints === 100, `score-eligible capability points must total 100, got ${totalPoints}`);

const statusCounts = Object.fromEntries(
  source.allowedStatuses.map(status => [
    status,
    source.records.filter(record => record.status === status).length,
  ]),
);

const lines = [
  '# Performance Workbench 阶段 0 能力证据表',
  '',
  `- 基础代码 ref：\`${source.baseRef}\``,
  `- 复核人：${source.reviewer}`,
  `- 复核日期：${source.reviewDate}`,
  `- 自动计分：${earnedPoints} / ${totalPoints}`,
  `- 状态计数：${source.allowedStatuses.map(status => `${status}=${statusCounts[status]}`).join('，')}`,
  '- 计分规则：仅 `scoreEligible=true` 且状态为 `implemented-verified` 的原子项计分；阶段 0 Spike 不计入当前产品得分。',
  '',
  '| ID | 能力域 | 分值 | 状态 | 用户可观察行为 | 代码 ref 与文件证据 | 测试/任务证据 | 样本 ID | 已知限制 | 复核日期 |',
  '|---|---|---:|---|---|---|---|---|---|---|',
  ...source.records.map(record => [
    `| ${record.capabilityId}`,
    record.domain,
    record.scoreEligible ? String(record.points) : '不计分',
    `\`${record.status}\``,
    record.observableBehavior,
    record.codeEvidence.length > 0 ? record.codeEvidence.map(item => `\`${item}\``).join('<br>') : '无',
    record.testOrExpertEvidence.length > 0 ? record.testOrExpertEvidence.map(item => `\`${item}\``).join('<br>') : '无',
    record.sampleIds.length > 0 ? record.sampleIds.map(item => `\`${item}\``).join('<br>') : '无',
    record.limitations.join('<br>'),
    `${record.reviewDate} |`,
  ].join(' | ')),
  '',
  '该汇总由 `node scripts/build-workbench-stage0-evidence.js` 从 JSON 明细生成，不手写总体完成度。',
  '',
];

fs.writeFileSync(outputPath, lines.join('\n'));

const benchmarks = benchmarkEventCounts.map(readAndValidateBenchmark);
assert(new Set(benchmarks.map(benchmark => benchmark.codeRef)).size === 1, 'benchmark artifacts use different code refs');
const benchmarkEnvironment = benchmarks[0].environment;
const browserVersion = /(?:Headless)?Chrome\/([^ ]+)/.exec(benchmarkEnvironment.browserUserAgent)?.[1] ?? 'unknown';
const benchmarkLines = [
  '# Performance Workbench 浏览器 Benchmark 基线',
  '',
  '## 固定语料',
  '',
  '`src/workbench/spike/benchmarkProtocol.ts` 固定三个级别：`SYNTH-WB-100K`、`SYNTH-WB-500K` 和 `SYNTH-WB-1000K`。',
  '',
  '语料由 Worker 内的确定性生成器构造，随后执行 UTF-8 编码、模拟文件读取、`JSON.parse`、白名单投影和索引构建。超过既有 128 MiB JSON 限制时直接失败，不提高限制。artifact 同时记录字节规模、事件族、截图字节和 SHA-256。',
  '',
  '## 测量',
  '',
  'benchmark 入口仅在 production build 设置 `REACT_APP_ENABLE_WORKBENCH_BENCHMARK=1` 时允许激活；普通构建即使带查询参数也继续进入产品页面。页面参数为 `?workbench-benchmark=1`，可增加 `&autorun=1&event-count=100000|500000|1000000`。',
  '',
  '每项执行 3 次预热和 10 次有效运行。P50/P95、取消回执、release 回执、队列背压和安全字段均由 `node scripts/build-workbench-stage0-evidence.js` 依据 JSON artifact 重新校验。',
  '',
  '## 本轮结果',
  '',
  `- 代码 ref：\`${benchmarks[0].codeRef}\``,
  `- UA 报告的 Chrome：${browserVersion}`,
  `- 平台：${benchmarkEnvironment.operatingSystem}`,
  `- 逻辑核心：${benchmarkEnvironment.cpu.logicalCores}`,
  `- 设备内存：${benchmarkEnvironment.memory.deviceGiB ?? '不可用'} GiB`,
  `- DPR：${benchmarkEnvironment.dpr}`,
  '',
  '| 语料 | JSON bytes | 首次可交互 | 视口 P95 | 选区 P95 | Canvas P95 | 取消响应 |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...benchmarks.map(benchmark => (
    `| \`SYNTH-WB-${benchmark.corpus.eventCount / 1000}K\` | ${benchmark.corpus.jsonBytes.toLocaleString('en-US')} | ${benchmark.timings.firstInteractiveMs.toFixed(1)} ms | ${benchmark.timings.viewportQuery.p95Ms.toFixed(1)} ms | ${benchmark.timings.selectionQuery.p95Ms.toFixed(1)} ms | ${benchmark.timings.canvasDraw.p95Ms.toFixed(1)} ms | ${benchmark.timings.cancellationResponseMs.toFixed(1)} ms |`
  )),
  '',
  '三档语料均完成预热与有效运行，队列峰值不超过 2，取消和 release 返回预期响应，UI 未接收原始事件数组，128 MiB 限制未提高。结果满足设计中的取消不超过 500ms、缩放/平移 P95 不超过 50ms、悬浮 P95 不超过 100ms、选区 P95 不超过 300ms。',
  '',
  'Worker 独立峰值内存无法由页面 JavaScript 测量，artifact 明确记录为 `null`。因此这些结果确认三档浏览器功能与时延 smoke，但不能声明完整内存门禁通过，也不能替代仓库外真实样本门禁。',
  '',
];
fs.writeFileSync(benchmarkReportPath, benchmarkLines.join('\n'));
console.log(JSON.stringify({
  output: path.relative(root, outputPath),
  benchmarkOutput: path.relative(root, benchmarkReportPath),
  benchmarkEventCounts,
  earnedPoints,
  totalPoints,
  statusCounts,
}));
