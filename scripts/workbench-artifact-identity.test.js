#!/usr/bin/env node

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  actualHead,
  assertBuildIdentity,
  buildIdentity,
  changedRuntimeInputHash,
  runtimeInputHash,
  writeBuildIdentity,
} = require('./workbench-artifact-identity');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-build-identity-'));
const root = path.resolve(__dirname, '..');

try {
  assert.match(runtimeInputHash(root), /^[a-f0-9]{64}$/);
  assert.match(changedRuntimeInputHash(root, actualHead(root)), /^[a-f0-9]{64}$/);
  fs.writeFileSync(path.join(tempDir, 'index.html'), '<!doctype html>\n');
  const expected = buildIdentity({
    head: 'abc123',
    inputHash: 'runtime-hash',
    role: 'stage6-product',
    flags: {
      REACT_APP_ENABLE_TRACE_STAGE6: '1',
      REACT_APP_ENABLE_TRACE_STAGE5: '1',
    },
  });
  writeBuildIdentity(tempDir, expected);
  assert.deepEqual(assertBuildIdentity(tempDir, expected), expected);
  assert.throws(
    () => assertBuildIdentity(tempDir, {
      ...expected,
      runtimeInputHash: 'changed-runtime-hash',
    }),
    /runtime input hash differs/,
  );
  assert.throws(
    () => assertBuildIdentity(tempDir, {
      ...expected,
      flags: {
        ...expected.flags,
        REACT_APP_ENABLE_TRACE_STAGE6: '0',
      },
    }),
    /feature flags differ/,
  );
  fs.rmSync(path.join(tempDir, '.workbench-build-identity.json'));
  assert.throws(
    () => assertBuildIdentity(tempDir, expected),
    /build identity is missing/,
  );
  process.stdout.write('workbench artifact identity tests passed\n');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
