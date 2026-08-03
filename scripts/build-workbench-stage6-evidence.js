#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  actualHead,
  changedRuntimeInputHash,
  runtimeInputHash,
} = require('./workbench-artifact-identity');

const root = path.resolve(__dirname, '..');
const reportDir = path.join(root, 'docs/superpowers/reports');
const eventCounts = [100_000, 500_000, 1_000_000];
const forbiddenPayloadKeys = new Set([
  'args',
  'rawtrace',
  'rawevent',
  'authorization',
  'cookie',
  'token',
  'querytoken',
  'url',
  'fullurl',
  'screenshot',
  'screenshotbytes',
  'snapshot',
  'snapshotbytes',
  'code',
  'source',
  'script',
  'moduleurl',
  'networkurl',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizedObject(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sameObject(left, right) {
  return JSON.stringify(normalizedObject(left))
    === JSON.stringify(normalizedObject(right));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(reportDir, file), 'utf8'));
}

function validation(name, command) {
  const value = process.env[name];
  assert(value === 'passed' || value === 'failed', `${name} was not recorded`);
  return { command, result: value };
}

function suffix(eventCount) {
  return eventCount === 1_000_000 ? '1000k' : `${eventCount / 1_000}k`;
}

function workingTreeDiffHash(baseRef) {
  return changedRuntimeInputHash(root, baseRef);
}

function collectForbiddenKeys(value, matches = new Set()) {
  if (Array.isArray(value)) {
    value.forEach(item => collectForbiddenKeys(item, matches));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenPayloadKeys.has(key.toLowerCase())) matches.add(key);
      collectForbiddenKeys(item, matches);
    }
  }
  return [...matches].sort();
}

function capabilityScore() {
  const source = readJson('workbench-stage0-capabilities.json');
  let earnedPoints = 0;
  let totalPoints = 0;
  for (const record of source.records) {
    if (!record.scoreEligible) continue;
    for (const criterion of record.criteria) {
      totalPoints += criterion.points;
      if (criterion.status === 'implemented-verified') {
        earnedPoints += criterion.points;
      }
    }
  }
  return { earnedPoints, totalPoints };
}

function main() {
  const head = actualHead(root);
  const status = childProcess.execFileSync('git', ['status', '--short'], {
    cwd: root,
    encoding: 'utf8',
  }).trimEnd().split('\n').filter(Boolean);
  const diffHash = workingTreeDiffHash(head);
  const inputHash = runtimeInputHash(root);
  const browsers = eventCounts.map(eventCount => (
    readJson(`workbench-stage6-browser-${suffix(eventCount)}.json`)
  ));
  const ui = readJson('workbench-stage6-ui-validation.json');
  const buildMatrix = readJson('workbench-stage6-build-matrix.json');
  const realSampleGate = readJson('trace-real-sample-gate-status.json');
  const browserInputDiffHash = browsers[0].workingTreeDiffHash;
  const browserRuntimeInputHash = browsers[0].runtimeInputHash;
  const regressionFailures = [];
  const performanceFailures = [];
  const productFlags = {
    REACT_APP_ENABLE_TRACE_WORKBENCH: '1',
    REACT_APP_ENABLE_TRACE_TIMELINE: '1',
    REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS: '1',
    REACT_APP_ENABLE_TRACE_CROSS_SOURCE: '1',
    REACT_APP_ENABLE_TRACE_STAGE5: '1',
    REACT_APP_ENABLE_TRACE_STAGE6: '1',
  };
  const flagOffFlags = {
    ...productFlags,
    REACT_APP_ENABLE_TRACE_STAGE6: '0',
  };
  assert(
    diffHash === browserInputDiffHash,
    'Runtime inputs changed after the Stage 6 browser benchmark',
  );
  assert(
    inputHash === browserRuntimeInputHash,
    'Runtime content changed after the Stage 6 browser benchmark',
  );

  for (const artifact of browsers) {
    const label = `${artifact.corpus.eventCount} events`;
    assert(artifact.schemaVersion === 6, `${label}: schema is not Stage 6`);
    assert(artifact.status === 'browser-benchmark-verified', `${label}: browser failed`);
    assert(
      artifact.workingTreeDiffHash === browserInputDiffHash,
      `${label}: browser input diff hash changed`,
    );
    assert(
      artifact.runtimeInputHash === browserRuntimeInputHash,
      `${label}: browser runtime input hash changed`,
    );
    assert(
      artifact.buildIdentity?.head === head
        && artifact.buildIdentity?.runtimeInputHash === browserRuntimeInputHash
        && artifact.buildIdentity?.role === 'stage6-product'
        && sameObject(artifact.buildIdentity.flags, productFlags),
      `${label}: browser build identity differs`,
    );
    assert(
      artifact.runs.warmupCount === 5 && artifact.runs.validRunCount === 10,
      `${label}: benchmark run count differs`,
    );
    for (const [metric, budget] of Object.entries({
      zoom: 50,
      pan: 50,
      hover: 100,
      cancellationResponse: 500,
      selectionQuery: 300,
      customQuery: 300,
      pluginInstall: 300,
      pluginRefresh: 300,
      projectedTrackUpdate: 300,
    })) {
      const timing = artifact.timings[metric];
      assert(timing.samplesMs.length === 10, `${label}: ${metric} sample count differs`);
      if (timing.p95Ms > budget) {
        performanceFailures.push({
          eventCount: artifact.corpus.eventCount,
          metric,
          p95Ms: timing.p95Ms,
          budgetMs: budget,
        });
      }
    }
    assert(
      artifact.memory.workerPeakBytes === null,
      `${label}: Worker peak memory was fabricated`,
    );
    assert(
      artifact.resources.activeQueryCount === 0
        && artifact.resources.trackPluginCount === 0
        && artifact.resources.projectedOverlaysRemoved === true
        && artifact.resources.workerTerminated === true,
      `${label}: Stage 6 resources were not released`,
    );
    assert(
      artifact.resources.blobUrlsCreated === artifact.resources.blobUrlsRevoked
        && artifact.resources.canvasRemoved === true,
      `${label}: browser resources leaked`,
    );
    assert(artifact.consoleErrors.length === 0, `${label}: console errors occurred`);
    const stage6 = artifact.interactions.stage6;
    assert(stage6.customQuery.requestSent, `${label}: custom query was not sent`);
    assert(stage6.customQuery.staleResultCleared, `${label}: stale query result remained`);
    assert(
      stage6.customQuery.truncatedLimitationVisible,
      `${label}: query truncation limitation was not visible`,
    );
    assert(stage6.plugin.installRequestSent, `${label}: plugin install was not sent`);
    assert(stage6.plugin.refreshRequestSent, `${label}: plugin refresh was not sent`);
    assert(stage6.plugin.trackVisible, `${label}: plugin track was not visible`);
    assert(stage6.plugin.hideShowVerified, `${label}: plugin hide/show failed`);
    assert(stage6.plugin.removeVerified, `${label}: plugin remove failed`);
    for (const capability of [
      'layout-shifts',
      'animation-composition',
      'memory-trend',
      'gpu-raster',
    ]) {
      const statuses = stage6.advancedAnalysis[capability] ?? [];
      assert(statuses.includes('available'), `${label}: ${capability} was not available`);
      assert(statuses.includes('unavailable'), `${label}: ${capability} fallback was not observed`);
    }
    for (const [metric, comparison] of Object.entries(
      artifact.stage5Regression ?? {},
    )) {
      if (comparison.regressionRatio > 0.1) {
        regressionFailures.push({
          eventCount: artifact.corpus.eventCount,
          metric,
          ...comparison,
        });
      }
    }
  }

  assert(
    ui.workingTreeDiffHash === browserInputDiffHash,
    'UI browser input diff hash changed',
  );
  assert(
    ui.runtimeInputHash === browserRuntimeInputHash,
    'UI browser runtime input hash changed',
  );
  assert(
    ui.buildIdentity?.role === 'stage6-product'
      && sameObject(ui.buildIdentity.flags, productFlags)
      && ui.flagOffBuildIdentity?.role === 'stage6-flag-off'
      && sameObject(ui.flagOffBuildIdentity.flags, flagOffFlags),
    'UI build identities differ',
  );
  assert(
    ui.flagOff?.stage6UiAbsent === true
      && ui.flagOff?.noStage6Queries === true
      && ui.flagOff?.stage1To5Present === true
      && ui.flagOff?.error === null,
    'Stage 6 flag-off isolation failed',
  );
  assert(
    Object.values(ui.viewports).every(viewport => viewport.passed),
    'Stage 6 responsive verification failed',
  );
  assert(
    ui.themes.lightApplied
      && ui.themes.darkApplied
      && ui.themes.distinct
      && ui.themes.reducedMotion,
    'Stage 6 theme or reduced-motion verification failed',
  );
  assert(buildMatrix.status === 'passed', 'Build matrix failed');
  assert(buildMatrix.uniqueBuildCount === 6, 'Build matrix is incomplete');
  assert(
    buildMatrix.workingTreeDiffHash === browserInputDiffHash,
    'Build matrix browser input diff hash changed',
  );
  assert(
    buildMatrix.runtimeInputHash === browserRuntimeInputHash,
    'Build matrix browser runtime input hash changed',
  );
  assert(buildMatrix.actualHead === head, 'Build matrix HEAD differs');
  for (const configuration of buildMatrix.configurations) {
    const expectedRole = configuration.id === 5
      ? 'stage6-flag-off'
      : configuration.id === 6
        ? 'stage6-product'
        : `stage6-matrix-${configuration.id}`;
    assert(
      configuration.buildIdentity?.head === head
        && configuration.buildIdentity?.runtimeInputHash === browserRuntimeInputHash
        && configuration.buildIdentity?.role === expectedRole,
      `Build matrix identity differs: ${configuration.name}`,
    );
    assert(
      sameObject(configuration.buildIdentity.flags, configuration.flags),
      `Build matrix flags differ: ${configuration.name}`,
    );
  }
  const regressionBaselineState = browsers.every(artifact => (
    Object.keys(artifact.stage5Regression ?? {}).length === 4
  ))
    ? 'comparable'
    : 'baseline-unavailable';

  const structuredPayloadLeaks = [
    ...browsers.flatMap(artifact => (
      artifact.interactions.stage6.customQuery.forbiddenPayloadKeys
    )),
    ...collectForbiddenKeys({
      browserStage6: browsers.map(artifact => artifact.interactions.stage6),
      flagOff: ui.flagOff,
    }),
  ];
  const privacyPassed = structuredPayloadLeaks.length === 0;
  assert(
    privacyPassed,
    `Structured Stage 6 payload leaked keys: ${structuredPayloadLeaks.join(', ')}`,
  );
  const validations = [
    validation(
      'STAGE6_TARGETED_JEST',
      'Stage 6 targeted Jest suites',
    ),
    validation(
      'STAGE6_TARGETED_ESLINT',
      'Stage 6 targeted ESLint',
    ),
    validation(
      'STAGE6_SCRIPT_TESTS',
      'node scripts/workbench-artifact-identity.test.js',
    ),
    { command: 'npm run workbench:stage6-browser', result: 'passed' },
    validation(
      'STAGE6_BUILD_MATRIX',
      'node scripts/run-workbench-stage6-build-matrix.js',
    ),
    validation(
      'STAGE6_FULL_JEST',
      'CI=true npm test -- --watchAll=false --runInBand --no-cache',
    ),
    validation(
      'STAGE6_REPO_ESLINT',
      'npx eslint src --ext .ts,.tsx --no-cache',
    ),
    validation(
      'STAGE6_PRIVACY_RESOURCES',
      'Stage 6 privacy and resource assertions',
    ),
    validation('STAGE6_DIFF_CHECK', 'git diff --check'),
  ];
  const validationFailures = validations.filter(item => item.result !== 'passed');
  const score = capabilityScore();
  const realSampleManifestConfigured = Boolean(
    process.env.TRACE_SAMPLE_MANIFEST_PATH,
  );
  const realSampleVerified = realSampleGate.gatePassed === true
    && realSampleGate.currentRun?.executed === true
    && realSampleGate.currentRun?.failedSampleIds?.length === 0
    && realSampleGate.runtimeInputHash === inputHash
    && realSampleGate.codeRef === head;
  const realSampleState = realSampleVerified
    ? 'real-sample-verified'
    : realSampleManifestConfigured
      ? 'manifest-present-not-verified'
      : 'real-sample-blocked';
  const blockers = [
    ...(!realSampleVerified ? ['real-sample-blocked'] : []),
    'worker-peak-memory-unmeasured',
    ...(performanceFailures.length > 0 ? ['browser-performance-gate-failed'] : []),
    ...(regressionFailures.length > 0 ? ['stage5-regression-gate-failed'] : []),
    ...(validationFailures.length > 0 ? ['automated-validation-failed'] : []),
  ];
  const codeMergeReady = performanceFailures.length === 0
    && regressionFailures.length === 0
    && validationFailures.length === 0;
  const releaseAccepted = blockers.length === 0;
  const evidence = {
    schemaVersion: 1,
    reviewDate: new Date().toISOString(),
    baseline: {
      actualHead: head,
      workingTreeDiffHash: diffHash,
      runtimeInputHash: inputHash,
      browserInputDiffHash,
      browserRuntimeInputHash,
      workingTreeDirty: status.length > 0,
      gitStatusShort: status,
    },
    environment: {
      node: process.version,
      npm: childProcess.execFileSync('npm', ['--version'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      chromeUserAgent: browsers[0].environment.browserUserAgent,
      operatingSystem: browsers[0].environment.operatingSystem,
    },
    capabilityScore: score,
    verification: {
      implemented: true,
      automatedVerified: validationFailures.length === 0,
      browserSyntheticVerified:
        performanceFailures.length === 0,
      realSample: realSampleState,
      workerPeakMemoryBytes: null,
      workerMemoryState: 'worker-peak-memory-unmeasured',
    },
    codeMergeReady,
    releaseAccepted,
    blockers,
    performanceGate: {
      budgetsMs: {
        zoom: 50,
        pan: 50,
        hover: 100,
        cancellationResponse: 500,
        selectionQuery: 300,
        customQuery: 300,
        pluginInstall: 300,
        pluginRefresh: 300,
        projectedTrackUpdate: 300,
      },
      failures: performanceFailures,
      stage5RegressionThreshold: 0.1,
      regressionBaselineState,
      regressionFailures,
      baseline: regressionBaselineState === 'comparable'
        ? 'Stage 5 artifacts use the same measurement method.'
        : 'No Stage 5 browser artifacts with the same measurement method are available.',
      corpora: browsers.map(artifact => ({
        eventCount: artifact.corpus.eventCount,
        sampleHash: artifact.corpus.sampleHash,
        timings: artifact.timings,
        stage5Regression: artifact.stage5Regression,
      })),
    },
    browser: {
      state: 'browser-synthetic-verified',
      featureFlagIsolation: ui.flagOff,
      interactions: ui.interactions.stage6,
      responsive: ui.viewports,
      themes: ui.themes,
      resources: ui.resources,
      consoleErrors: ui.consoleErrors,
    },
    buildMatrix,
    realSampleGate: {
      state: realSampleState,
      manifestConfigured: realSampleManifestConfigured,
      artifact: 'docs/superpowers/reports/trace-real-sample-gate-status.json',
      gatePassed: realSampleVerified,
    },
    privacy: {
      result: privacyPassed ? 'passed' : 'failed',
      structuredPayloadLeaks,
      note: 'Field names mentioned by limitations are not treated as payload leaks.',
    },
    validations,
  };
  fs.writeFileSync(
    path.join(reportDir, 'workbench-stage6-evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(reportDir, 'workbench-stage6-evidence.md'),
    [
      '# Performance Workbench Stage 6 Evidence',
      '',
      `- Actual HEAD: \`${head}\``,
      `- Working-tree diff hash: \`${diffHash}\``,
      `- Capability score: ${score.earnedPoints} / ${score.totalPoints}`,
      `- Code merge ready: \`${codeMergeReady}\``,
      '- Browser verification: `browser-synthetic-verified`',
      `- Real samples: \`${realSampleState}\``,
      '- Worker peak memory: `worker-peak-memory-unmeasured`',
      `- Release accepted: \`${releaseAccepted}\``,
      `- Blockers: ${blockers.map(item => `\`${item}\``).join('、') || 'none'}`,
      '',
      'The JSON artifact is authoritative for commands, raw summaries, gates, and limitations.',
      '',
    ].join('\n'),
  );
  if (!codeMergeReady) process.exitCode = 1;
}

main();
