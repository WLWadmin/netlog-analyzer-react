#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  OPTIONAL_CAPABILITIES,
  REQUIRED_CAPABILITIES,
  compareStability,
  decideSpike,
  projectReport,
  removeValidatedTempDirectory,
  scanGeneratedOutput,
  scanToolSource,
  validateCleanupTarget,
  validateManifest,
} = require('./spike-core');
const {
  assertOutsideWorktrees,
  assertOutputInsideRepository,
  assessMemoryTrend,
  buildCapabilityResults,
  buildStagePlan,
  classifyRunError,
  createDryRunReport,
  evaluateSpdxExpression,
  executeStages,
  findMissingSamples,
  parseWorktreeRoots,
  parseArgs,
  projectFactSatisfies,
  renderMarkdownReport,
  summarizeRunFailures,
  unresolvedLicenseEntries,
  validateCommitSha,
  validateExactVersion,
  validatePackageName,
} = require('./run-spike');

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

function expectThrow(run, messagePattern) {
  assert.throws(run, messagePattern);
}

function validCapabilities() {
  const capabilities = {};
  for (const capability of REQUIRED_CAPABILITIES) {
    capabilities[capability] = { status: 'available', positiveSamples: [] };
  }
  for (const capability of OPTIONAL_CAPABILITIES) {
    capabilities[capability] = { status: 'available', positiveSamples: [] };
  }
  return capabilities;
}

function factsWithOrder(reverse = false) {
  const requests = [
    {
      navigationKey: 'nav-a',
      redirectIndex: 0,
      result: 'success',
      statusCode: 200,
      startUs: 20,
      endUs: 40,
      url: 'https://service.invalid/alpha?secret=removed#fragment',
      executionDurationMs: 999,
    },
    {
      navigationKey: 'nav-a',
      redirectIndex: 0,
      result: 'http-error',
      statusCode: 404,
      startUs: 50,
      endUs: 70,
      url: 'https://asset.invalid/beta?another=removed',
    },
  ];
  return {
    executionPath: '/not-persisted',
    navigations: [
      { key: 'nav-a', frameKey: 'frame-a', startUs: 10, endUs: 100, processCount: 1 },
    ],
    requests: reverse ? requests.reverse() : requests,
    milestones: [
      { navigationKey: 'nav-a', name: 'FCP', relativeUs: 30.00001 },
    ],
    mainThreadTasks: [
      {
        navigationKey: 'nav-a',
        processId: 1,
        threadId: 2,
        startUs: 60,
        durationMs: 55,
        selfTimeMs: 40,
      },
    ],
    interactions: [
      {
        interactionKey: 'interaction-a',
        navigationKey: 'nav-a',
        startUs: 80,
        inputDelayMs: 5,
        processingMs: 20,
        presentationMs: 10,
      },
    ],
    frames: [
      { navigationKey: 'nav-a', startUs: 75, durationMs: 18, dropped: false },
    ],
    capabilityAvailability: {
      'navigation-context': 'available',
      'network-lifecycle': 'available',
    },
  };
}

test('validates the five-sample manifest and required positive coverage', () => {
  const manifestPath = path.join(__dirname, 'sample-manifest.example.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const validated = validateManifest(manifest);
  assert.strictEqual(validated.samples.length, 5);

  const missingCoverage = JSON.parse(JSON.stringify(manifest));
  for (const sample of missingCoverage.samples) {
    sample.positiveCapabilities = sample.positiveCapabilities.filter(
      capability => capability !== 'interactions',
    );
  }
  expectThrow(
    () => validateManifest(missingCoverage),
    /manifest lacks positive samples for: interactions/,
  );
});

test('rejects duplicate aliases, unknown fields, and invalid capacity roles', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'sample-manifest.example.json'), 'utf8'),
  );
  manifest.samples[1].id = manifest.samples[0].id;
  expectThrow(() => validateManifest(manifest), /id must be unique/);

  const unknownField = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'sample-manifest.example.json'), 'utf8'),
  );
  unknownField.samples[0].fileName = 'forbidden';
  expectThrow(() => validateManifest(unknownField), /unsupported fields/);

  const invalidRole = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'sample-manifest.example.json'), 'utf8'),
  );
  invalidRole.samples[0].capacityRole = 'unbounded';
  expectThrow(() => validateManifest(invalidRole), /capacityRole is invalid/);
});

test('normalizes ordering and execution metadata before stability hashing', () => {
  const comparison = compareStability([
    factsWithOrder(false),
    factsWithOrder(true),
    { ...factsWithOrder(false), executionPath: '/different-ignored-value' },
  ]);
  assert.strictEqual(comparison.stable, true);
  assert.strictEqual(new Set(comparison.hashes).size, 1);
  const serialized = JSON.stringify(comparison.normalizedRuns[0]);
  assert(!serialized.includes('service.invalid'));
  assert(!serialized.includes('secret=removed'));
  assert(serialized.includes('host-'));
  assert(serialized.includes('path-'));
});

test('changes the normalized hash when a material fact changes', () => {
  const changed = factsWithOrder(false);
  changed.requests[0].statusCode = 500;
  changed.requests[0].result = 'http-error';
  const comparison = compareStability([
    factsWithOrder(false),
    factsWithOrder(false),
    changed,
  ]);
  assert.strictEqual(comparison.stable, false);
  assert.notStrictEqual(comparison.hashes[0], comparison.hashes[2]);
});

test('detects attribution changes even when aggregate counts stay equal', () => {
  const changed = factsWithOrder(false);
  changed.requests[0].navigationKey = 'nav-b';
  changed.mainThreadTasks[0].threadId = 99;
  const comparison = compareStability([
    factsWithOrder(false),
    factsWithOrder(false),
    changed,
  ]);

  assert.strictEqual(comparison.summaries[0].requestCount, comparison.summaries[2].requestCount);
  assert.strictEqual(comparison.summaries[0].taskCount, comparison.summaries[2].taskCount);
  assert.strictEqual(comparison.stable, false);
  assert.notStrictEqual(comparison.hashes[0], comparison.hashes[2]);
});

test('strictly scans generated output after report projection', () => {
  const projected = projectReport({
    schemaVersion: 1,
    branch: 'feature-branch',
    ignoredRawEngineObject: { traceEvents: [] },
    candidate: {
      packageName: 'candidate-package',
      version: '1.2.3',
      rawEnginePayload: { traceEvents: [{ args: { secret: 'forbidden' } }] },
    },
    samples: [{
      id: 'TRACE-SAMPLE-01',
      status: 'completed',
      inputRef: '/private/sample.trace',
      rawEnginePayload: { traceEvents: [] },
    }],
    decision: { result: 'BLOCKED_NEEDS_EVIDENCE' },
  });
  assert.strictEqual(projected.ignoredRawEngineObject, undefined);
  assert.strictEqual(projected.candidate.rawEnginePayload, undefined);
  assert.strictEqual(projected.samples[0].inputRef, undefined);
  assert.strictEqual(projected.samples[0].rawEnginePayload, undefined);
  assert.deepStrictEqual(scanGeneratedOutput(projected), []);
  assert(scanGeneratedOutput({ note: 'https://service.invalid/path' }).includes('url'));
  assert(scanGeneratedOutput({ note: 'Authorization: private-value' }).includes('sensitive-header'));
  assert(scanGeneratedOutput({ traceEvents: [] }).includes('raw-trace-events'));
  assert(scanGeneratedOutput({ path: '/Users/example/private-file' }).includes('absolute-user-path'));
});

test('keeps tool static checks separate from generated-output vocabulary', () => {
  assert.deepStrictEqual(
    scanToolSource('const headerName = "Authorization"; const cookieName = "Cookie";'),
    [],
  );
  assert(scanToolSource('const password = "not-a-placeholder-secret";').includes('hard-coded-secret'));
  assert(scanToolSource('const sample = "customer-session.trace";').includes('real-sample-filename'));
});

test('selects PASS, FAIL, and BLOCKED using required capability semantics', () => {
  const capabilities = validCapabilities();
  capabilities['forced-reflow-warning'] = { status: 'unavailable-optional', positiveSamples: [] };
  const pass = decideSpike({
    capabilities,
    validatedMaxJsonBytes: 1024,
  });
  assert.strictEqual(pass.result, 'PASS_RECOMMEND_ENGINE');
  assert.deepStrictEqual(pass.unavailableOptionalCapabilities, ['forced-reflow-warning']);

  const failCapabilities = validCapabilities();
  failCapabilities['renderer-tasks'] = {
    status: 'engine-missing',
    positiveSamples: ['TRACE-SAMPLE-01'],
  };
  const fail = decideSpike({ capabilities: failCapabilities });
  const failWithCapacity = decideSpike({
    capabilities: failCapabilities,
    validatedMaxJsonBytes: 1024,
  });
  assert.strictEqual(fail.result, 'BLOCKED_NEEDS_EVIDENCE');
  assert.strictEqual(failWithCapacity.result, 'FAIL_USE_MINIMAL_AGGREGATOR');
  assert.deepStrictEqual(failWithCapacity.blockingCapabilityGaps, ['renderer-tasks']);

  const missingEvidenceWins = decideSpike({
    capabilities: failCapabilities,
    validatedMaxJsonBytes: 1024,
    missingSamples: ['TRACE-SAMPLE-01'],
  });
  assert.strictEqual(missingEvidenceWins.result, 'BLOCKED_NEEDS_EVIDENCE');

  const passWithoutCapacity = decideSpike({ capabilities: validCapabilities() });
  assert.strictEqual(passWithoutCapacity.result, 'BLOCKED_NEEDS_EVIDENCE');

  const blocked = decideSpike({
    capabilities: validCapabilities(),
    validatedMaxJsonBytes: 1024,
    missingSamples: ['TRACE-SAMPLE-05'],
  });
  assert.strictEqual(blocked.result, 'BLOCKED_NEEDS_EVIDENCE');
  assert.deepStrictEqual(blocked.missingSamples, ['TRACE-SAMPLE-05']);
});

test('requires project fact contracts instead of handler presence', () => {
  const completeFacts = {
    navigations: [{
      key: 'NAV-A',
      frameKey: 'FRAME-A',
      processId: 1,
      threadId: 2,
      startUs: 100,
      endUs: 1000,
      processCount: 1,
    }, {
      key: 'NAV-B',
      frameKey: 'FRAME-B',
      processId: 3,
      threadId: 4,
      startUs: 1001,
      endUs: 2000,
      processCount: 1,
    }],
    requests: [{
      requestKey: 'REQ-A',
      navigationKey: 'NAV-A',
      redirectIndex: 0,
      result: 'success',
      statusCode: 200,
      startUs: 200,
      endUs: 300,
      url: 'https://example.invalid/path',
      initiatorKey: 'REQ-PARENT',
    }],
    milestones: [{
      navigationKey: 'NAV-A',
      name: 'fcp',
      relativeUs: 250,
      candidate: false,
    }],
    mainThreadTasks: [{
      navigationKey: 'NAV-A',
      processId: 1,
      threadId: 2,
      startUs: 400,
      durationMs: 60,
      selfTimeMs: 40,
    }],
    interactions: [{
      interactionKey: 'INTERACTION-A',
      navigationKey: 'NAV-A',
      startUs: 500,
      inputDelayMs: 10,
      processingMs: 20,
      presentationMs: 30,
    }],
    frames: [{
      navigationKey: 'NAV-A',
      startUs: 600,
      durationMs: 18,
      dropped: false,
    }],
  };
  for (const capability of [
    'navigation-context',
    'page-milestones',
    'network-lifecycle',
    'network-initiators',
    'renderer-tasks',
    'multi-process-attribution',
    'interactions',
    'rendering-frames',
  ]) {
    assert.strictEqual(projectFactSatisfies(capability, completeFacts), true);
  }
  assert.strictEqual(projectFactSatisfies('multi-process-attribution', {
    ...completeFacts,
    navigations: [completeFacts.navigations[0]],
  }), false);
  assert.strictEqual(projectFactSatisfies('network-lifecycle', {
    ...completeFacts,
    requests: [{ ...completeFacts.requests[0], result: '' }],
  }), false);

  const manifest = validateManifest(JSON.parse(
    fs.readFileSync(path.join(__dirname, 'sample-manifest.example.json'), 'utf8'),
  ));
  const sampleRuns = new Map(manifest.samples.map(sample => [
    sample.id,
    [1, 2, 3].map(index => ({
      hash: `hash-${sample.id}-${index}`,
      projectFacts: completeFacts,
      detectedEventFamilies: sample.expectedEventFamilies,
    })),
  ]));
  const failures = new Map(manifest.samples.map(sample => [sample.id, []]));
  const results = buildCapabilityResults(manifest, sampleRuns, failures, true);
  assert.strictEqual(results['network-lifecycle'].status, 'available');

  sampleRuns.get('TRACE-SAMPLE-01')[0].projectFacts = {
    ...completeFacts,
    mainThreadTasks: [{ ...completeFacts.mainThreadTasks[0], threadId: undefined }],
  };
  const incomplete = buildCapabilityResults(manifest, sampleRuns, failures, true);
  assert.strictEqual(incomplete['renderer-tasks'].status, 'adapter-risk');

  sampleRuns.get('TRACE-SAMPLE-05')[0].detectedEventFamilies = [];
  const missingFamily = buildCapabilityResults(manifest, sampleRuns, failures, true);
  assert.strictEqual(missingFamily.interactions.status, 'sample-missing');
  assert.strictEqual(missingFamily.interactions.reasonCode, 'declared-event-family-missing');
  assert.deepStrictEqual(findMissingSamples(manifest, sampleRuns, failures), ['TRACE-SAMPLE-05']);
});

test('classifies run failures and preserves timeout and crash semantics', () => {
  assert.deepStrictEqual(
    classifyRunError(new Error('TRACE_BROWSER_TIMEOUT')),
    { category: 'timeout', code: 'TRACE_WORKER_TIMEOUT' },
  );
  assert.deepStrictEqual(
    classifyRunError(new Error('Trace Engine Worker probe timed out')),
    { category: 'timeout', code: 'TRACE_WORKER_TIMEOUT' },
  );
  assert.deepStrictEqual(
    classifyRunError(new Error('Trace Engine Worker probe failed')),
    { category: 'worker', code: 'TRACE_WORKER_RUNTIME_FAILED' },
  );
  assert.deepStrictEqual(
    classifyRunError(new Error('TRACE_CHROMIUM_EXITED')),
    { category: 'crash', code: 'TRACE_CHROMIUM_EXITED' },
  );
  assert.deepStrictEqual(
    classifyRunError(new Error('TRACE_ENGINE_PARSE_FAILED')),
    { category: 'engine', code: 'TRACE_ENGINE_PARSE_FAILED' },
  );
  assert.deepStrictEqual(
    classifyRunError(new Error('contains local details')),
    { category: 'environment', code: 'TRACE_RUN_ENVIRONMENT_FAILED' },
  );
  assert.deepStrictEqual(summarizeRunFailures(new Map([
    ['TRACE-SAMPLE-01', [
      { category: 'timeout' },
      { category: 'engine' },
    ]],
    ['TRACE-SAMPLE-02', [
      { category: 'crash' },
      { category: 'worker' },
    ]],
  ])), {
    timeoutCount: 1,
    crashCount: 1,
    engineErrorCount: 1,
    workerErrorCount: 1,
  });
});

test('detects monotonic end-to-end memory growth', () => {
  assert.strictEqual(assessMemoryTrend([
    { peakMemoryBytes: 100 },
    { peakMemoryBytes: 120 },
    { peakMemoryBytes: 140 },
  ]), 'monotonic-growth');
  assert.strictEqual(assessMemoryTrend([
    { peakMemoryBytes: 100 },
    { peakMemoryBytes: 120 },
    { peakMemoryBytes: 110 },
  ]), 'no-monotonic-growth');
  assert.strictEqual(assessMemoryTrend([{ peakMemoryBytes: 100 }]), 'unverified');
});

test('blocks unresolved and rejected transitive licenses', () => {
  assert.strictEqual(evaluateSpdxExpression('MIT OR GPL-3.0-only'), 'accepted');
  assert.strictEqual(evaluateSpdxExpression('MIT AND GPL-3.0-only'), 'rejected');
  assert.strictEqual(
    evaluateSpdxExpression('(MIT OR BSD-3-Clause) AND Apache-2.0'),
    'accepted',
  );
  assert.strictEqual(
    evaluateSpdxExpression('Apache-2.0 WITH LLVM-exception'),
    'accepted',
  );
  assert.strictEqual(evaluateSpdxExpression('SEE LICENSE IN LICENSE'), 'unresolved');
  assert.strictEqual(evaluateSpdxExpression('LicenseRef-Custom'), 'unresolved');
  assert.strictEqual(evaluateSpdxExpression('Custom permissive text'), 'unresolved');
  assert.deepStrictEqual(unresolvedLicenseEntries([
    { identity: 'candidate@1.0.0', license: 'BSD-3-Clause' },
    { identity: 'dependency-a@2.0.0', license: 'UNRESOLVED' },
    { identity: 'dependency-b@3.0.0', license: 'GPL-3.0-only' },
    { identity: 'dependency-c@4.0.0', license: 'SEE LICENSE IN LICENSE' },
  ]), [
    'dependency-a@2.0.0:unresolved:UNRESOLVED',
    'dependency-b@3.0.0:rejected:GPL-3.0-only',
    'dependency-c@4.0.0:unresolved:SEE LICENSE IN LICENSE',
  ]);
});

test('projects consistent JSON and Markdown dry-run reports', () => {
  const report = createDryRunReport();
  const markdown = renderMarkdownReport(report);
  assert.strictEqual(report.decision.result, 'PASS_RECOMMEND_ENGINE');
  assert(markdown.includes('PASS_RECOMMEND_ENGINE'));
  assert(markdown.includes(report.toolCommitSha));
  assert.deepStrictEqual(scanGeneratedOutput(report), []);
  assert.deepStrictEqual(scanGeneratedOutput(markdown), []);
  const cleaned = projectReport({
    ...report,
    cleanup: { status: 'removed' },
  });
  assert.strictEqual(cleaned.cleanup.status, 'removed');
});

test('rejects files inside any registered worktree', () => {
  const roots = parseWorktreeRoots([
    'worktree /tmp/repository-main',
    'HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '',
    'worktree /tmp/repository-feature',
    'HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  ].join('\n'));
  assert.deepStrictEqual(roots, ['/tmp/repository-main', '/tmp/repository-feature']);

  const rootA = fs.mkdtempSync('/private/tmp/netlog-trace-worktree-a.');
  const rootB = fs.mkdtempSync('/private/tmp/netlog-trace-worktree-b.');
  const external = fs.mkdtempSync('/private/tmp/netlog-trace-external.');
  const insideOtherWorktree = path.join(rootB, 'manifest.json');
  const outside = path.join(external, 'manifest.json');
  fs.writeFileSync(insideOtherWorktree, '{}');
  fs.writeFileSync(outside, '{}');
  try {
    expectThrow(
      () => assertOutsideWorktrees(insideOtherWorktree, 'manifest', [rootA, rootB]),
      /outside every registered Git worktree/,
    );
    assert.strictEqual(
      assertOutsideWorktrees(outside, 'manifest', [rootA, rootB]),
      fs.realpathSync(outside),
    );
  } finally {
    fs.rmSync(rootA, { recursive: true });
    fs.rmSync(rootB, { recursive: true });
    fs.rmSync(external, { recursive: true });
  }
});

test('requires exact runtime versions and full tool commit SHAs', () => {
  assert.strictEqual(validatePackageName('@paulirish/trace_engine'), '@paulirish/trace_engine');
  expectThrow(
    () => validatePackageName('@paulirish/trace_engine"; throw new Error("injected")'),
    /valid npm package name/,
  );
  assert.strictEqual(validateExactVersion('1.2.3'), '1.2.3');
  expectThrow(() => validateExactVersion('^1.2.3'), /exact semantic version/);
  assert.strictEqual(validateCommitSha('a'.repeat(40)), 'a'.repeat(40));
  expectThrow(() => validateCommitSha('abc123'), /full lowercase Git SHA/);
  assert.strictEqual(parseArgs(['--dry-run']).dryRun, true);
  expectThrow(() => parseArgs([]), /Choose exactly one/);
  expectThrow(() => parseArgs(['--dry-run', '--execute']), /Choose exactly one/);
  assert.strictEqual(
    assertOutputInsideRepository('docs/superpowers/reports'),
    path.resolve(__dirname, '..', '..', 'docs/superpowers/reports'),
  );
  expectThrow(
    () => assertOutputInsideRepository('../outside-worktree'),
    /must be a child of the feature worktree/,
  );
});

test('defines the isolated execution stages without running them', () => {
  const stages = buildStagePlan();
  assert(stages.includes('install-exact-engine-version'));
  assert(stages.includes('run-browser-worker-probe'));
  assert(stages.includes('scan-generated-output'));
  assert.strictEqual(new Set(stages).size, stages.length);
});

test('propagates the failed stage and stops later orchestration', async () => {
  const observed = [];
  await assert.rejects(
    executeStages(
      ['prepare', 'fail', 'must-not-run'],
      {
        prepare: async () => { observed.push('prepare'); },
        fail: async () => {
          observed.push('fail');
          throw new Error('synthetic stage failure');
        },
        'must-not-run': async () => { observed.push('must-not-run'); },
      },
    ),
    error => {
      assert.strictEqual(error.stage, 'fail');
      assert.deepStrictEqual(error.completedStages, ['prepare']);
      return true;
    },
  );
  assert.deepStrictEqual(observed, ['prepare', 'fail']);
});

test('accepts only validated Spike cleanup directories and rejects escapes', () => {
  const approvedRoot = fs.realpathSync('/private/tmp');
  const validDirectory = fs.mkdtempSync('/private/tmp/netlog-trace-spike.');
  const otherDirectory = fs.mkdtempSync('/private/tmp/unrelated-trace-directory.');
  const symlinkPath = path.join(validDirectory, 'netlog-trace-spike.escape');
  fs.symlinkSync(otherDirectory, symlinkPath);
  try {
    assert.strictEqual(
      validateCleanupTarget(validDirectory, { approvedRoot, repositoryRoots: [__dirname] }),
      fs.realpathSync(validDirectory),
    );
    expectThrow(
      () => validateCleanupTarget('/private/tmp', { approvedRoot, repositoryRoots: [__dirname] }),
      /must be a child/,
    );
    expectThrow(
      () => validateCleanupTarget(otherDirectory, { approvedRoot, repositoryRoots: [__dirname] }),
      /fixed Spike prefix/,
    );
    expectThrow(
      () => validateCleanupTarget(symlinkPath, { approvedRoot, repositoryRoots: [__dirname] }),
      /fixed Spike prefix/,
    );
  } finally {
    if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
    if (fs.existsSync(otherDirectory)) fs.rmSync(otherDirectory, { recursive: true });
    if (fs.existsSync(validDirectory)) {
      removeValidatedTempDirectory(validDirectory, {
        approvedRoot,
        repositoryRoots: [__dirname],
      });
    }
  }
});

test('does not rely on the current user home as a cleanup target', () => {
  expectThrow(
    () => validateCleanupTarget(os.homedir(), {
      approvedRoot: fs.realpathSync('/private/tmp'),
      repositoryRoots: [],
    }),
    /must be a child/,
  );
});

async function main() {
  let failures = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      process.stdout.write(`ok - ${name}\n`);
    } catch (error) {
      failures += 1;
      process.stderr.write(`not ok - ${name}\n${error.stack}\n`);
    }
  }
  process.stdout.write(`${tests.length - failures}/${tests.length} tests passed\n`);
  if (failures > 0) process.exitCode = 1;
}

void main();
