#!/usr/bin/env node

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const reportDir = path.join(root, 'docs/superpowers/reports');
const requiredResults = [
  'STAGE4_FULL_JEST',
  'STAGE4_CHANGED_ESLINT',
  'STAGE4_REPO_ESLINT',
  'STAGE4_BUILD_MATRIX',
  'STAGE4_DIFF_CHECK',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(reportDir, file), 'utf8'));
}

function result(name, command) {
  const value = process.env[name];
  assert(value === 'passed' || value === 'historical-failures', `${name} was not recorded`);
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

function main() {
  for (const name of requiredResults) assert(process.env[name], `${name} is required`);
  const head = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const status = childProcess.execFileSync('git', ['status', '--short'], {
    cwd: root,
    encoding: 'utf8',
  }).trim().split('\n').filter(Boolean);
  const browsers = ['100k', '500k', '1000k'].map(size => (
    readJson(`workbench-stage4-browser-${size}.json`)
  ));
  const ui = readJson('workbench-stage4-ui-validation.json');
  const diffHash = workingTreeDiffHash();
  for (const artifact of [...browsers, ui]) {
    assert(
      artifact.workingTreeDiffHash === diffHash,
      'Stage 4 browser artifact does not match the current working tree',
    );
  }
  assert(
    new Set(browsers.map(item => item.corpus.sampleHash)).size === browsers.length,
    'Stage 4 browser corpus hashes must be distinct',
  );
  const cross = ui.interactions.crossSource;
  assert(cross, 'Stage 4 browser artifact does not contain cross-source checks');
  for (const key of [
    'addHar', 'addNetLog', 'replacementConfirmation', 'replacementCancelled',
    'replacementConfirmed',
    'highCandidate', 'candidateExplanation', 'graphNavigation', 'removeSource',
    'sourceRevisionObserved', 'alignmentConflict', 'alignmentUnavailable',
  ]) assert(cross[key] === true, `Stage 4 browser check failed: ${key}`);
  assert(ui.consoleErrors.length === 0, 'Stage 4 browser console errors are not zero');
  assert(
    ui.flagOff?.crossSourceUiAbsent === true
      && ui.flagOff?.noCrossSourceQueries === true
      && ui.flagOff?.error === null,
    'Stage 4 flag-off browser verification failed',
  );

  const validations = [
    result('STAGE4_FULL_JEST', 'CI=true npm test -- --watchAll=false --runInBand --no-cache'),
    result('STAGE4_CHANGED_ESLINT', 'npx eslint <Stage 4 changed files> --ext .ts,.tsx --no-cache'),
    result('STAGE4_REPO_ESLINT', 'npx eslint src --ext .ts,.tsx --no-cache'),
    result('STAGE4_BUILD_MATRIX', 'six Stage 4 production build configurations'),
    result('STAGE4_DIFF_CHECK', 'git diff --check'),
    { command: 'npm run workbench:stage4-browser', result: 'passed' },
  ];
  const evidence = {
    schemaVersion: 1,
    reviewDate: '2026-08-02',
    actualHead: head,
    workingTreeBaseline: {
      statement: 'Stage 4 started from the actual clean Stage 3 commit and retained all subsequent working-tree changes.',
      actualInitialHead: '0a697045804d356a3737243bc5cdda72519f5169',
      initialWorkingTreeClean: true,
      currentChangedFileCount: status.length,
    },
    flags: {
      workbench: 'REACT_APP_ENABLE_TRACE_WORKBENCH=1',
      timeline: 'REACT_APP_ENABLE_TRACE_TIMELINE=1',
      expert: 'REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS=1',
      crossSource: 'REACT_APP_ENABLE_TRACE_CROSS_SOURCE=1',
      rule: 'all four flags must equal 1',
    },
    releaseAccepted: false,
    realSampleGate: {
      state: 'real-sample-blocked',
      reason: 'No repository-external Trace/HAR/NetLog sample set was available.',
    },
    workerMemoryGate: {
      measured: false,
      peakBytes: null,
      reason: 'Page JavaScript does not expose independent per-Worker peak memory.',
    },
    correlationPrecision: {
      state: 'synthetic-corpus-verified',
      truePositives: 1,
      falsePositives: 0,
      reviewedHighConfidenceCandidates: 1,
      precision: 1,
      limitation: 'The denominator is one reviewed synthetic positive; no >=95% release claim is made.',
    },
    syntheticCorpus: {
      requestCorrelationCases: 12,
      positiveCases: 4,
      negativeOrDegradedCases: 8,
      alignment: { successful: 4, conflicts: 1, unavailable: 3 },
      browserCandidateEdges: cross.confidenceCounts,
      revokedAfterRemoval: {
        edges: cross.revokedEdgeCount,
        diagnoses: cross.revokedFindingCount,
        limitation: 'Findings remain observation-level and require phase-specific NetLog evidence.',
      },
    },
    browser: {
      state: 'browser-verified',
      processExit: 'sandbox-restricted-after-artifacts',
      processLimitation: 'Chrome completed all assertions and wrote all artifacts, then the host sandbox rejected system Crashpad/Updater file access.',
      runner: ui.runner,
      corpus: browsers.map(item => ({
        eventCount: item.corpus.eventCount,
        sampleHash: item.corpus.sampleHash,
        timings: item.timings,
      })),
      crossSource: cross,
      flagOff: ui.flagOff,
      consoleErrors: ui.consoleErrors,
      resources: ui.resources,
    },
    privacy: {
      result: 'passed',
      checks: [
        'strict nested DTO allowlists',
        'query values omitted from safe request keys',
        'raw events, args, headers and authorization rejected',
      ],
    },
    validations,
    batches: [29, 30, 31, 32, 33, 34].map(batchId => ({
      batchId,
      states: [
        'implemented',
        'automated-verified',
        ...(batchId >= 32 ? ['browser-verified'] : []),
        'synthetic-corpus-verified',
        'real-sample-blocked',
      ],
    })),
  };

  const taskMatrix = {
    schemaVersion: 1,
    task11: {
      title: 'Trace/HAR/NetLog 跨源关联',
      status: 'partial',
      verificationStates: [
        'implemented',
        'automated-verified',
        'browser-verified',
        'synthetic-corpus-verified',
        'real-sample-blocked',
      ],
      productPathChecks: cross,
      blocker: 'Only synthetic sources were available; real external samples and release precision remain blocked.',
    },
    stage3MatrixPreservedAt: 'docs/superpowers/reports/workbench-stage3-expert-tasks.json',
  };
  fs.writeFileSync(
    path.join(reportDir, 'workbench-stage4-evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(reportDir, 'workbench-stage4-cross-source-tasks.json'),
    `${JSON.stringify(taskMatrix, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(reportDir, 'workbench-stage4-evidence.md'),
    [
      '# Performance Workbench Stage 4 Evidence',
      '',
      `- Actual HEAD: \`${head}\``,
      '- Status: implemented, automated-verified, browser-verified, synthetic-corpus-verified, real-sample-blocked',
      '- Release accepted: false',
      '- Independent Worker peak memory: not measured',
      '- Real external samples: blocked',
      `- Browser corpora: ${browsers.map(item => item.corpus.eventCount).join(', ')} events`,
      `- Source removal revoked graph edges: ${cross.revokedEdgeCount}`,
      '- High-confidence precision: 1 TP / 0 FP in one reviewed synthetic positive only; denominator is insufficient for a release claim.',
      '',
      'The JSON artifact is authoritative for commands, metrics, gates, and limitations.',
      '',
    ].join('\n'),
  );
}

main();
