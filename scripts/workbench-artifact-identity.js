#!/usr/bin/env node

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BUILD_IDENTITY_FILE = '.workbench-build-identity.json';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function actualHead(root) {
  return childProcess.execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

function hashFiles(root, files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function runtimeInputFiles(root) {
  return childProcess.execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      'package.json',
      'src',
      'scripts',
    ],
    { cwd: root, encoding: 'utf8' },
  ).split('\n')
    .filter(Boolean)
    .filter(file => fs.existsSync(path.join(root, file)))
    .sort();
}

function runtimeInputHash(root) {
  return hashFiles(root, runtimeInputFiles(root));
}

function changedRuntimeInputFiles(root, baseRef) {
  const changed = childProcess.execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', baseRef, '--', 'package.json', 'src', 'scripts'],
    { cwd: root, encoding: 'utf8' },
  ).split('\n').filter(Boolean);
  const untracked = childProcess.execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '--', 'package.json', 'src', 'scripts'],
    { cwd: root, encoding: 'utf8' },
  ).split('\n').filter(Boolean);
  return [...new Set([...changed, ...untracked])].sort();
}

function changedRuntimeInputHash(root, baseRef) {
  return hashFiles(root, changedRuntimeInputFiles(root, baseRef));
}

function normalizedFlags(flags) {
  return Object.fromEntries(
    Object.entries(flags).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function buildIdentity({ head, inputHash, flags, role }) {
  return {
    schemaVersion: 1,
    head,
    runtimeInputHash: inputHash,
    role,
    flags: normalizedFlags(flags),
  };
}

function writeBuildIdentity(buildDir, identity) {
  assert(
    fs.existsSync(path.join(buildDir, 'index.html')),
    `Build output is missing index.html: ${buildDir}`,
  );
  fs.writeFileSync(
    path.join(buildDir, BUILD_IDENTITY_FILE),
    `${JSON.stringify(identity, null, 2)}\n`,
  );
}

function assertBuildIdentity(buildDir, expected) {
  const manifestPath = path.join(buildDir, BUILD_IDENTITY_FILE);
  assert(
    fs.existsSync(path.join(buildDir, 'index.html')),
    `Reusable build is missing index.html: ${buildDir}`,
  );
  assert(
    fs.existsSync(manifestPath),
    `Reusable build identity is missing: ${manifestPath}`,
  );
  const actual = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(actual.schemaVersion === 1, `Unsupported build identity: ${manifestPath}`);
  assert(actual.head === expected.head, `Reusable build HEAD differs: ${buildDir}`);
  assert(
    actual.runtimeInputHash === expected.runtimeInputHash,
    `Reusable build runtime input hash differs: ${buildDir}`,
  );
  assert(actual.role === expected.role, `Reusable build role differs: ${buildDir}`);
  assert(
    JSON.stringify(normalizedFlags(actual.flags))
      === JSON.stringify(normalizedFlags(expected.flags)),
    `Reusable build feature flags differ: ${buildDir}`,
  );
  return actual;
}

module.exports = {
  BUILD_IDENTITY_FILE,
  actualHead,
  assertBuildIdentity,
  buildIdentity,
  changedRuntimeInputFiles,
  changedRuntimeInputHash,
  runtimeInputFiles,
  runtimeInputHash,
  writeBuildIdentity,
};
