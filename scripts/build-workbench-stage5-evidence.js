#!/usr/bin/env node

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const reportDir = path.join(root, 'docs/superpowers/reports');
const eventCounts = [100_000, 500_000, 1_000_000];
const allowedStates = new Set([
  'implemented',
  'automated-verified',
  'browser-verified',
  'synthetic-corpus-verified',
  'real-sample-blocked',
  'partial',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(reportDir, file), 'utf8'));
}

function result(name, command) {
  const value = process.env[name];
  assert(
    value === 'passed' || value === 'historical-failures',
    `${name} was not recorded`,
  );
  return { command, result: value };
}

function workingTreeDiffHash() {
  const files = childProcess.execFileSync(
    'git',
    ['ls-files', '--modified', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' },
  ).split('\n')
    .filter(Boolean)
    .filter(file => (
      file === 'package.json'
      || file.startsWith('src/')
      || file.startsWith('scripts/')
    ))
    .sort();
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function suffix(eventCount) {
  return eventCount === 1_000_000 ? '1000k' : `${eventCount / 1_000}k`;
}

function validateArtifact(artifact, eventCount, diffHash, regressionFailures) {
  const label = `${eventCount} events`;
  assert(artifact.schemaVersion === 5, `${label}: schema is not Stage 5`);
  assert(artifact.status === 'browser-benchmark-verified', `${label}: browser failed`);
  assert(artifact.workingTreeDiffHash === diffHash, `${label}: working tree changed`);
  assert(artifact.corpus.eventCount === eventCount, `${label}: event count differs`);
  for (const field of [
    'sourceBytes',
    'jsonBytes',
    'screenshotEncodedBytes',
    'screenshotDecodedBytes',
  ]) {
    assert(
      Number.isFinite(artifact.corpus[field]) && artifact.corpus[field] >= 0,
      `${label}: corpus.${field} is missing`,
    );
  }
  assert(
    artifact.runs.warmupCount >= 3 && artifact.runs.validRunCount >= 10,
    `${label}: insufficient benchmark runs`,
  );
  for (const [name, budget] of Object.entries({
    zoom: 50,
    pan: 50,
    hover: 100,
    selectionQuery: 300,
  })) {
    const timing = artifact.timings[name];
    assert(timing.samplesMs.length === artifact.runs.validRunCount, `${label}: ${name} samples`);
    assert(timing.p95Ms <= budget, `${label}: ${name} P95 exceeds ${budget} ms`);
  }
  assert(
    Number.isFinite(artifact.transfer.workerUiBytes),
    `${label}: transfer bytes are missing`,
  );
  assert(
    artifact.memory.pageHeapUsedBytes === null
      || Number.isFinite(artifact.memory.pageHeapUsedBytes),
    `${label}: page heap measurement is invalid`,
  );
  assert(artifact.memory.workerPeakBytes === null, `${label}: Worker peak was fabricated`);
  assert(
    /does not expose per-Worker peak memory/.test(artifact.memory.limitation),
    `${label}: Worker memory limitation is missing`,
  );
  for (const field of [
    'viewportObserved',
    'viewportTruncated',
    'viewportSampled',
    'selectionObserved',
    'selectionTruncated',
  ]) {
    assert(
      Number.isInteger(artifact.truncation[field])
        && artifact.truncation[field] >= 0,
      `${label}: truncation.${field} is missing`,
    );
  }
  assert(artifact.truncation.viewportObserved > 0, `${label}: no viewport result observed`);
  assert(artifact.truncation.selectionObserved > 0, `${label}: no selection result observed`);
  assert(artifact.queue.viewport.maxQueueDepth <= 2, `${label}: viewport queue is unbounded`);
  assert(artifact.queue.selection.maxQueueDepth <= 2, `${label}: selection queue is unbounded`);
  assert(artifact.resources.sessionClosed === true, `${label}: session was not closed`);
  assert(
    artifact.resources.blobUrlsCreated === artifact.resources.blobUrlsRevoked,
    `${label}: Blob URLs leaked`,
  );
  assert(artifact.resources.canvasRemoved === true, `${label}: Canvas was not released`);
  assert(artifact.consoleErrors.length === 0, `${label}: console errors were recorded`);
  assert(
    artifact.runner.componentMounts.Insights === true
      && artifact.runner.componentMounts.TraceComparison === true,
    `${label}: Stage 5 components were not mounted`,
  );
  for (const [name, comparison] of Object.entries(artifact.stage4Regression ?? {})) {
    if (comparison.regressionRatio > 0.1) {
      regressionFailures.push({
        eventCount,
        metric: name,
        currentP95Ms: comparison.currentP95Ms,
        baselineP95Ms: comparison.baselineP95Ms,
        regressionRatio: comparison.regressionRatio,
      });
    }
  }
  assert(
    Object.keys(artifact.stage4Regression ?? {}).length === 4,
    `${label}: Stage 4 regression baseline is incomplete`,
  );
}

function main() {
  const head = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const diffHash = workingTreeDiffHash();
  const regressionFailures = [];
  const browsers = eventCounts.map(eventCount => (
    readJson(`workbench-stage5-browser-${suffix(eventCount)}.json`)
  ));
  for (let index = 0; index < browsers.length; index += 1) {
    validateArtifact(
      browsers[index],
      eventCounts[index],
      diffHash,
      regressionFailures,
    );
  }
  assert(
    new Set(browsers.map(artifact => artifact.corpus.sampleHash)).size === 3,
    'Synthetic corpus hashes must be distinct',
  );
  const ui = readJson('workbench-stage5-ui-validation.json');
  assert(ui.workingTreeDiffHash === diffHash, 'UI artifact working tree differs');
  assert(
    ui.flagOff?.stage5UiAbsent === true
      && ui.flagOff?.noStage5Queries === true
      && ui.flagOff?.error === null,
    'Stage 5 flag-off verification failed',
  );

  const validations = [
    result('STAGE5_FULL_JEST', 'CI=true npm test -- --watchAll=false --runInBand --no-cache'),
    result('STAGE5_REPO_ESLINT', 'npx eslint src --ext .ts,.tsx --no-cache'),
    result('STAGE5_BUILD_MATRIX', 'Stage 5 feature-flag off/on production build matrix'),
    result('STAGE5_DIFF_CHECK', 'git diff --check'),
    result('STAGE5_PRIVACY_RESOURCES', 'privacy scan and resource-release checks'),
    { command: 'npm run workbench:stage5-browser', result: 'passed' },
  ];
  const batches = [
    {
      batchId: 35,
      states: [
        'implemented',
        'automated-verified',
        'synthetic-corpus-verified',
        'real-sample-blocked',
      ],
      limitation: 'Candidate contribution is verified only with synthetic correlations.',
    },
    {
      batchId: 36,
      states: ['implemented', 'automated-verified'],
      limitation: 'Timeout failure closure is deterministic and does not claim real-sample coverage.',
    },
    {
      batchId: 37,
      states: [
        'implemented',
        'automated-verified',
        'browser-verified',
        'synthetic-corpus-verified',
        'real-sample-blocked',
      ],
      limitation: 'Insights are deterministic local rules, not root-cause confirmation.',
    },
    {
      batchId: 38,
      states: ['implemented', 'automated-verified', 'browser-verified'],
      limitation: 'LOD and truncation are visible; Event Log remains a bounded virtual window.',
    },
    {
      batchId: 39,
      states: [
        'implemented',
        'automated-verified',
        'synthetic-corpus-verified',
        'real-sample-blocked',
      ],
      limitation: 'No repository-external same-scenario Trace pair was available.',
    },
    {
      batchId: 40,
      states: [
        'implemented',
        'automated-verified',
        'browser-verified',
        'synthetic-corpus-verified',
        'real-sample-blocked',
        'partial',
      ],
      limitation: 'Independent Worker peak memory and real-sample validation remain unavailable.',
    },
  ];
  for (const batch of batches) {
    for (const state of batch.states) {
      assert(allowedStates.has(state), `Unsupported evidence state: ${state}`);
    }
  }
  const evidence = {
    schemaVersion: 1,
    reviewDate: '2026-08-02',
    actualHead: head,
    workingTreeDiffHash: diffHash,
    flags: {
      workbench: 'REACT_APP_ENABLE_TRACE_WORKBENCH=1',
      timeline: 'REACT_APP_ENABLE_TRACE_TIMELINE=1',
      expert: 'REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS=1',
      crossSource: 'REACT_APP_ENABLE_TRACE_CROSS_SOURCE=1',
      stage5: 'REACT_APP_ENABLE_TRACE_STAGE5=1',
      rule: 'all five flags must equal 1',
    },
    releaseAccepted: false,
    overallStatus: 'partial',
    realSampleGate: {
      state: 'real-sample-blocked',
      reason: 'No repository-external Trace/HAR/NetLog or same-scenario comparison set was available.',
    },
    workerMemoryGate: {
      state: 'partial',
      measured: false,
      peakBytes: null,
      reason: 'Page JavaScript does not expose independent per-Worker peak memory.',
    },
    regressionGate: {
      threshold: 0.1,
      baseline: 'Stage 4 browser P95 artifacts',
      passed: regressionFailures.length === 0,
      failures: regressionFailures,
      comparisons: browsers.map(artifact => ({
        eventCount: artifact.corpus.eventCount,
        metrics: artifact.stage4Regression,
      })),
    },
    browser: {
      state: 'browser-verified',
      corpus: browsers.map(artifact => ({
        environment: artifact.environment,
        corpus: artifact.corpus,
        timings: artifact.timings,
        transfer: artifact.transfer,
        memory: artifact.memory,
        truncation: artifact.truncation,
        queue: artifact.queue,
        resources: artifact.resources,
      })),
      flagOff: ui.flagOff,
    },
    validations,
    batches,
  };
  const taskMatrix = {
    schemaVersion: 1,
    stage: 5,
    status: 'partial',
    releaseAccepted: false,
    allowedStates: [...allowedStates],
    batches,
    blockers: [
      'real-sample-blocked',
      'Independent Worker peak memory is unmeasured',
    ],
    previousStage: 'docs/superpowers/reports/workbench-stage4-cross-source-tasks.json',
  };
  fs.writeFileSync(
    path.join(reportDir, 'workbench-stage5-evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(reportDir, 'workbench-stage5-task-matrix.json'),
    `${JSON.stringify(taskMatrix, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(reportDir, 'workbench-stage5-evidence.md'),
    [
      '# Performance Workbench Stage 5 Evidence',
      '',
      `- Actual HEAD: \`${head}\``,
      '- Status: `partial`',
      '- Verification: `implemented`, `automated-verified`, `browser-verified`, `synthetic-corpus-verified`',
      '- Real samples: `real-sample-blocked`',
      '- Release accepted: `false`',
      '- Independent Worker peak memory: unmeasured',
      '- Regression threshold: 10% against Stage 4 browser P95',
      `- Browser corpora: ${eventCounts.join(', ')} events`,
      '',
      'The JSON artifact is authoritative for metrics, commands, gates, and limitations.',
      '',
    ].join('\n'),
  );
  if (regressionFailures.length > 0) {
    process.stderr.write(
      `Stage 5 regression gate failed: ${JSON.stringify(regressionFailures)}\n`,
    );
    process.exitCode = 1;
  }
}

main();
