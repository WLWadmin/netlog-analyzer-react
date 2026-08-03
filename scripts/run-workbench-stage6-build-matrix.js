#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  actualHead,
  assertBuildIdentity,
  buildIdentity,
  changedRuntimeInputHash,
  runtimeInputHash,
  writeBuildIdentity,
} = require('./workbench-artifact-identity');

const root = path.resolve(__dirname, '..');
const reportDir = path.join(root, 'docs/superpowers/reports');
const sharedFlags = {
  REACT_APP_ENABLE_TRACE_WORKBENCH: '0',
  REACT_APP_ENABLE_TRACE_TIMELINE: '0',
  REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS: '0',
  REACT_APP_ENABLE_TRACE_CROSS_SOURCE: '0',
  REACT_APP_ENABLE_TRACE_STAGE5: '0',
  REACT_APP_ENABLE_TRACE_STAGE6: '0',
};
const configurations = [
  {
    id: 1,
    name: 'all-disabled',
    buildPath: '/tmp/netlog-workbench-stage6-matrix-1-disabled',
    flags: {},
  },
  {
    id: 2,
    name: 'workbench',
    buildPath: '/tmp/netlog-workbench-stage6-matrix-2-workbench',
    flags: { REACT_APP_ENABLE_TRACE_WORKBENCH: '1' },
  },
  {
    id: 3,
    name: 'timeline',
    buildPath: '/tmp/netlog-workbench-stage6-matrix-3-timeline',
    flags: {
      REACT_APP_ENABLE_TRACE_WORKBENCH: '1',
      REACT_APP_ENABLE_TRACE_TIMELINE: '1',
    },
  },
  {
    id: 4,
    name: 'expert-analysis',
    buildPath: '/tmp/netlog-workbench-stage6-matrix-4-expert',
    flags: {
      REACT_APP_ENABLE_TRACE_WORKBENCH: '1',
      REACT_APP_ENABLE_TRACE_TIMELINE: '1',
      REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS: '1',
    },
  },
  {
    id: 5,
    name: 'stage5-stage6-off',
    buildPath: '/tmp/netlog-workbench-stage6-flag-off-build',
    flags: {
      REACT_APP_ENABLE_TRACE_WORKBENCH: '1',
      REACT_APP_ENABLE_TRACE_TIMELINE: '1',
      REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS: '1',
      REACT_APP_ENABLE_TRACE_CROSS_SOURCE: '1',
      REACT_APP_ENABLE_TRACE_STAGE5: '1',
    },
    reusedFromBrowserRunner: true,
    buildRole: 'stage6-flag-off',
  },
  {
    id: 6,
    name: 'stage6-all-on',
    buildPath: '/tmp/netlog-workbench-stage6-product-build',
    flags: {
      REACT_APP_ENABLE_TRACE_WORKBENCH: '1',
      REACT_APP_ENABLE_TRACE_TIMELINE: '1',
      REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS: '1',
      REACT_APP_ENABLE_TRACE_CROSS_SOURCE: '1',
      REACT_APP_ENABLE_TRACE_STAGE5: '1',
      REACT_APP_ENABLE_TRACE_STAGE6: '1',
    },
    reusedFromBrowserRunner: true,
    buildRole: 'stage6-product',
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function workingTreeDiffHash(baseRef) {
  return changedRuntimeInputHash(root, baseRef);
}

function build(configuration, identity) {
  const flags = { ...sharedFlags, ...configuration.flags };
  const expected = buildIdentity({
    ...identity,
    role: configuration.buildRole ?? `stage6-matrix-${configuration.id}`,
    flags,
  });
  if (configuration.reusedFromBrowserRunner) {
    return assertBuildIdentity(configuration.buildPath, expected);
  }
  childProcess.execFileSync('npm', ['run', 'build'], {
    cwd: root,
    env: {
      ...process.env,
      ...flags,
      CI: 'true',
      DISABLE_ESLINT_PLUGIN: 'true',
      PUBLIC_URL: '/',
      BUILD_PATH: configuration.buildPath,
    },
    stdio: 'inherit',
  });
  writeBuildIdentity(configuration.buildPath, expected);
  return expected;
}

function main() {
  const head = actualHead(root);
  const diffHash = workingTreeDiffHash(head);
  const inputHash = runtimeInputHash(root);
  const identity = { head, inputHash };
  const buildIdentities = configurations.map(configuration => (
    build(configuration, identity)
  ));
  assert(
    workingTreeDiffHash(head) === diffHash
      && runtimeInputHash(root) === inputHash,
    'Runtime inputs changed while executing the build matrix',
  );
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, 'workbench-stage6-build-matrix.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      actualHead: head,
      workingTreeDiffHash: diffHash,
      runtimeInputHash: inputHash,
      status: 'passed',
      uniqueBuildCount: 6,
      executedByThisCommand: 4,
      reusedBrowserBuilds: 2,
      configurations: configurations.map((configuration, index) => ({
        id: configuration.id,
        name: configuration.name,
        buildPath: configuration.buildPath,
        flags: { ...sharedFlags, ...configuration.flags },
        result: 'passed',
        reusedFromBrowserRunner:
          configuration.reusedFromBrowserRunner === true,
        buildIdentity: buildIdentities[index],
      })),
    }, null, 2)}\n`,
  );
}

main();
