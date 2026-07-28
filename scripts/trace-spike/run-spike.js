#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const {
  OPTIONAL_CAPABILITIES,
  REQUIRED_CAPABILITIES,
  compareStability,
  decideSpike,
  projectReport,
  removeValidatedTempDirectory,
  scanGeneratedOutput,
  scanToolSource,
  sha256,
  validateCleanupTarget,
  validateManifest,
} = require('./spike-core');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const APPROVED_TEMP_ROOT = '/private/tmp';
const TEMP_PREFIX = path.join(APPROVED_TEMP_ROOT, 'netlog-trace-spike.');

function parseArgs(argv) {
  const result = {
    dryRun: false,
    execute: false,
    enginePackage: '@paulirish/trace_engine',
  };
  const valueOptions = new Set([
    '--engine-package',
    '--engine-version',
    '--manifest',
    '--prd',
    '--output-dir',
    '--tool-commit-sha',
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      result.dryRun = true;
      continue;
    }
    if (arg === '--execute') {
      result.execute = true;
      continue;
    }
    if (!valueOptions.has(arg)) {
      throw new Error(`Unsupported argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${arg} requires a value`);
    }
    index += 1;
    const key = {
      '--engine-package': 'enginePackage',
      '--engine-version': 'engineVersion',
      '--manifest': 'manifestPath',
      '--prd': 'prdPath',
      '--output-dir': 'outputDir',
      '--tool-commit-sha': 'toolCommitSha',
    }[arg];
    result[key] = value;
  }
  if (result.dryRun === result.execute) {
    throw new Error('Choose exactly one of --dry-run or --execute');
  }
  return result;
}

function validateExactVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('--engine-version must be an exact semantic version');
  }
  return version;
}

function validatePackageName(value) {
  if (
    typeof value !== 'string'
    || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value)
  ) {
    throw new Error('--engine-package must be a valid npm package name');
  }
  return value;
}

function validateCommitSha(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error('--tool-commit-sha must be a full lowercase Git SHA');
  }
  return value;
}

function parseWorktreeRoots(output) {
  return String(output)
    .split(/\r?\n/)
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length))
    .filter(Boolean);
}

function getRegisteredWorktreeRoots() {
  const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error('Unable to enumerate registered Git worktrees');
  }
  return parseWorktreeRoots(result.stdout);
}

function assertOutsideWorktrees(filePath, label, worktreeRoots) {
  const resolved = fs.realpathSync(filePath);
  for (const root of worktreeRoots) {
    const resolvedRoot = fs.realpathSync(root);
    const relative = path.relative(resolvedRoot, resolved);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new Error(`${label} must be outside every registered Git worktree`);
    }
  }
  return resolved;
}

function assertOutputInsideRepository(outputPath) {
  const resolved = path.resolve(outputPath);
  const relative = path.relative(PROJECT_ROOT, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('--output-dir must be a child of the feature worktree');
  }
  return resolved;
}

function listToolFiles() {
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else files.push(fullPath);
    }
  };
  visit(__dirname);
  return files.sort();
}

function checkToolSources() {
  const failures = [];
  for (const filePath of listToolFiles()) {
    if (!/\.(?:js|ts)$/.test(filePath) || path.basename(filePath) === 'self-test.js') {
      continue;
    }
    const source = fs.readFileSync(filePath, 'utf8');
    for (const code of scanToolSource(source)) {
      failures.push(`${path.relative(PROJECT_ROOT, filePath)}:${code}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Tool static check failed: ${failures.join(', ')}`);
  }
}

function buildStagePlan() {
  return [
    'validate-tool-source',
    'create-private-tmp-directory',
    'validate-cleanup-target',
    'clone-tool-commit',
    'install-exact-engine-version',
    'inject-reachable-probes',
    'run-ordinary-jest-isolation-check',
    'run-jest-contract-probe',
    'run-cra-production-build',
    'run-browser-worker-probe',
    'validate-external-manifest',
    'run-sample-matrix-three-times',
    'project-allowlisted-report',
    'scan-generated-output',
    'copy-safe-report',
    'cleanup-private-tmp-directory',
  ];
}

async function executeStages(stages, handlers) {
  const completed = [];
  for (const stage of stages) {
    const handler = handlers[stage];
    if (typeof handler !== 'function') {
      throw new Error(`No handler registered for stage: ${stage}`);
    }
    try {
      await handler();
      completed.push(stage);
    } catch (error) {
      error.stage = stage;
      error.completedStages = completed;
      throw error;
    }
  }
  return completed;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const error = new Error(`${options.stage || command} failed`);
    error.code = options.errorCode || 'TRACE_SPIKE_COMMAND_FAILED';
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return result;
}

function createDryRunReport() {
  const capabilities = {};
  for (const capability of REQUIRED_CAPABILITIES) {
    capabilities[capability] = { status: 'available', positiveSamples: [] };
  }
  for (const capability of OPTIONAL_CAPABILITIES) {
    capabilities[capability] = { status: 'unavailable-optional', positiveSamples: [] };
  }
  const decision = decideSpike({
    capabilities,
    validatedMaxJsonBytes: 1,
  });
  return projectReport({
    schemaVersion: 1,
    prd: {
      documentId: 'chromium-performance-trace-diagnosis-prd-and-design',
      date: '2026-07-28',
      sha256: '0'.repeat(64),
      forbiddenNestedValue: { traceEvents: [] },
    },
    branch: 'dry-run',
    baselineCommitSha: '0'.repeat(40),
    toolCommitSha: '0'.repeat(40),
    candidate: {
      packageName: 'runtime-parameter',
      version: 'runtime-parameter',
      license: 'not-read',
    },
    samples: [],
    capabilities,
    stability: [],
    capacity: {
      validatedMaxJsonBytes: 1,
      memoryTrend: 'not-measured',
      timeoutCount: 0,
      crashCount: 0,
    },
    privacy: {
      allowlistProjectionPassed: true,
      generatedOutputScanPassed: true,
      toolStaticCheckPassed: true,
      failureCodes: [],
    },
    cleanup: { status: 'dry-run' },
    decision,
  });
}

function renderMarkdownReport(report) {
  const lines = [
    '# Chromium Trace Engine Spike Report',
    '',
    `- Result: \`${report.decision?.result || 'UNKNOWN'}\``,
    `- Branch: \`${report.branch || 'unknown'}\``,
    `- Tool commit: \`${report.toolCommitSha || 'unknown'}\``,
    `- Candidate: \`${report.candidate?.packageName || 'unknown'}@${report.candidate?.version || 'unknown'}\``,
    `- Validated max JSON bytes: \`${report.capacity?.validatedMaxJsonBytes || 0}\``,
    '',
    '## Capability Results',
    '',
    '| Capability | Status |',
    '|---|---|',
  ];
  for (const [capability, result] of Object.entries(report.capabilities || {})) {
    lines.push(`| \`${capability}\` | \`${result.status || 'unknown'}\` |`);
  }
  lines.push('', '## Samples', '', '| Sample | Status | JSON bytes | Runs |', '|---|---|---:|---:|');
  for (const sample of report.samples || []) {
    lines.push(
      `| \`${sample.id || 'unknown'}\` | \`${sample.status || 'unknown'}\` | `
      + `${sample.jsonBytes || 0} | ${(sample.parseDurationsMs || []).length} |`,
    );
  }
  lines.push('', 'This report contains only allowlisted, pseudonymized Spike results.', '');
  return lines.join('\n');
}

function exerciseReportCopy(tempDirectory) {
  const report = createDryRunReport();
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdownReport(report);
  const failures = [...scanGeneratedOutput(report), ...scanGeneratedOutput(markdown)];
  if (failures.length > 0) {
    throw new Error(`Dry-run report privacy scan failed: ${[...new Set(failures)].join(', ')}`);
  }
  const staging = path.join(tempDirectory, 'report-staging');
  const copied = path.join(tempDirectory, 'report-copy');
  fs.mkdirSync(staging);
  fs.mkdirSync(copied);
  fs.writeFileSync(path.join(staging, 'spike-report.json'), json);
  fs.writeFileSync(path.join(staging, 'spike-report.md'), markdown);
  fs.copyFileSync(
    path.join(staging, 'spike-report.json'),
    path.join(copied, 'spike-report.json'),
  );
  fs.copyFileSync(
    path.join(staging, 'spike-report.md'),
    path.join(copied, 'spike-report.md'),
  );
  if (fs.readFileSync(path.join(copied, 'spike-report.json'), 'utf8') !== json) {
    throw new Error('Dry-run report copy verification failed');
  }
  return { reportProjected: true, privacyScanned: true, reportCopied: true };
}

async function runDryRun() {
  checkToolSources();
  const tempDirectory = fs.mkdtempSync(TEMP_PREFIX);
  let cleanupStatus = 'not-started';
  let reportAssertions;
  const stages = buildStagePlan();
  const exercisedStages = [];
  try {
    validateCleanupTarget(tempDirectory, {
      approvedRoot: APPROVED_TEMP_ROOT,
      repositoryRoots: [PROJECT_ROOT],
    });
    const handlers = Object.fromEntries(stages.map(stage => [stage, async () => {
      exercisedStages.push(stage);
    }]));
    handlers['create-private-tmp-directory'] = async () => {
      exercisedStages.push('create-private-tmp-directory');
      fs.writeFileSync(path.join(tempDirectory, 'dry-run-marker'), 'trace-spike-dry-run\n');
    };
    handlers['project-allowlisted-report'] = async () => {
      exercisedStages.push('project-allowlisted-report');
      reportAssertions = exerciseReportCopy(tempDirectory);
    };
    handlers['scan-generated-output'] = async () => {
      exercisedStages.push('scan-generated-output');
      if (!reportAssertions?.privacyScanned) throw new Error('dry-run privacy scan was not exercised');
    };
    handlers['copy-safe-report'] = async () => {
      exercisedStages.push('copy-safe-report');
      if (!reportAssertions?.reportCopied) throw new Error('dry-run report copy was not exercised');
    };
    await executeStages(stages, handlers);
    cleanupStatus = 'validated';
  } finally {
    removeValidatedTempDirectory(tempDirectory, {
      approvedRoot: APPROVED_TEMP_ROOT,
      repositoryRoots: [PROJECT_ROOT],
    });
    cleanupStatus = 'removed';
  }

  const result = {
    mode: 'dry-run',
    stages,
    exercisedStages,
    assertions: {
      dependencyInstalled: false,
      manifestRead: false,
      sampleRead: false,
      httpStarted: false,
      chromiumStarted: false,
      productionFilesModified: false,
      cleanupStatus,
      ...reportAssertions,
    },
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function validateRealRunArgs(options, worktreeRoots = getRegisteredWorktreeRoots()) {
  validatePackageName(options.enginePackage);
  validateExactVersion(options.engineVersion);
  validateCommitSha(options.toolCommitSha);
  if (!options.manifestPath || !options.prdPath || !options.outputDir) {
    throw new Error('--manifest, --prd, and --output-dir are required with --execute');
  }
  assertOutsideWorktrees(options.manifestPath, 'manifest', worktreeRoots);
  assertOutsideWorktrees(options.prdPath, 'PRD', worktreeRoots);
  assertOutputInsideRepository(options.outputDir);
  return worktreeRoots;
}

function findChromium() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) throw new Error('TRACE_CHROMIUM_NOT_FOUND');
  return executable;
}

function injectProbes(cloneRoot, enginePackage) {
  const sourceDirectory = path.join(__dirname, 'probes');
  const targetDirectory = path.join(cloneRoot, 'src', 'trace-spike-probe');
  fs.mkdirSync(targetDirectory, { recursive: true });
  for (const name of fs.readdirSync(sourceDirectory)) {
    const source = fs.readFileSync(path.join(sourceDirectory, name), 'utf8')
      .replaceAll('__TRACE_ENGINE_PACKAGE__', enginePackage);
    fs.writeFileSync(path.join(targetDirectory, name), source);
  }
  const entryPath = path.join(cloneRoot, 'src', 'index.tsx');
  fs.appendFileSync(
    entryPath,
    "\nimport { runTraceSpikeBrowserHarness } from './trace-spike-probe/trace-cra-entry.probe';\n"
      + "void runTraceSpikeBrowserHarness();\n",
  );
}

function normalizeLicense(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && typeof value.type === 'string') {
    return value.type.trim();
  }
  if (Array.isArray(value)) {
    const licenses = value.map(normalizeLicense).filter(item => item !== 'UNRESOLVED');
    return licenses.length > 0 ? licenses.join(' OR ') : 'UNRESOLVED';
  }
  return 'UNRESOLVED';
}

const ALLOWED_SPDX_LICENSES = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'Unicode-3.0',
  'Zlib',
]);
const ALLOWED_SPDX_EXCEPTIONS = new Set(['LLVM-exception']);

function tokenizeSpdx(expression) {
  if (typeof expression !== 'string'
    || !expression.trim()
    || /\bSEE LICENSE IN\b/i.test(expression)
    || /\bLicenseRef-/i.test(expression)) {
    return undefined;
  }
  const tokens = expression.match(/\(|\)|\bAND\b|\bOR\b|\bWITH\b|[A-Za-z0-9][A-Za-z0-9.+-]*/g);
  if (!tokens || tokens.join(' ').replace(/\s+/g, '') !== expression.replace(/\s+/g, '')) {
    return undefined;
  }
  return tokens;
}

function evaluateSpdxExpression(expression) {
  const tokens = tokenizeSpdx(expression);
  if (!tokens) return 'unresolved';
  let index = 0;

  const parsePrimary = () => {
    if (tokens[index] === '(') {
      index += 1;
      const value = parseOr();
      if (tokens[index] !== ')') throw new Error('invalid SPDX parentheses');
      index += 1;
      return value;
    }
    const license = tokens[index];
    if (!license || ['AND', 'OR', 'WITH', ')'].includes(license)) {
      throw new Error('invalid SPDX license');
    }
    index += 1;
    let accepted = ALLOWED_SPDX_LICENSES.has(license);
    let known = accepted || /^(?:A?GPL|LGPL|AGPL|SSPL|BUSL)-/i.test(license);
    if (tokens[index] === 'WITH') {
      index += 1;
      const exception = tokens[index];
      if (!exception || ['AND', 'OR', 'WITH', '(', ')'].includes(exception)) {
        throw new Error('invalid SPDX exception');
      }
      index += 1;
      accepted = accepted && ALLOWED_SPDX_EXCEPTIONS.has(exception);
      known = known && ALLOWED_SPDX_EXCEPTIONS.has(exception);
    }
    return { accepted, known };
  };

  const parseAnd = () => {
    let value = parsePrimary();
    while (tokens[index] === 'AND') {
      index += 1;
      const right = parsePrimary();
      value = {
        accepted: value.accepted && right.accepted,
        known: value.known && right.known,
      };
    }
    return value;
  };

  const parseOr = () => {
    let value = parseAnd();
    while (tokens[index] === 'OR') {
      index += 1;
      const right = parseAnd();
      value = {
        accepted: value.accepted || right.accepted,
        known: value.known && right.known,
      };
    }
    return value;
  };

  try {
    const result = parseOr();
    if (index !== tokens.length) return 'unresolved';
    if (result.accepted) return 'accepted';
    return result.known ? 'rejected' : 'unresolved';
  } catch (_error) {
    return 'unresolved';
  }
}

function readInstalledLicenseInventory(cloneRoot, rootPackageName) {
  const tree = JSON.parse(runCommand('npm', ['ls', '--all', '--json', '--long'], {
    cwd: cloneRoot,
    stage: 'read-installed-dependency-tree',
  }).stdout);
  const inventory = new Map();
  const visit = (name, node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.path === 'string' && typeof node.version === 'string') {
      const packageJsonPath = path.join(node.path, 'package.json');
      let license = 'UNRESOLVED';
      if (fs.existsSync(packageJsonPath)) {
        const metadata = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        license = normalizeLicense(metadata.license || metadata.licenses);
      }
      inventory.set(`${name}@${node.version}`, license);
    }
    for (const [childName, child] of Object.entries(node.dependencies || {})) {
      visit(childName, child);
    }
  };
  visit(rootPackageName, tree.dependencies?.[rootPackageName]);
  return [...inventory.entries()]
    .map(([identity, license]) => ({ identity, license }))
    .sort((left, right) => left.identity.localeCompare(right.identity));
}

function unresolvedLicenseEntries(inventory) {
  return inventory
    .map(item => ({
      ...item,
      policy: evaluateSpdxExpression(item.license),
    }))
    .filter(item => item.policy !== 'accepted')
    .map(item => `${item.identity}:${item.policy}:${item.license}`);
}

function readCandidateMetadata(cloneRoot, packageName, licenseInventory) {
  const packagePath = path.join(cloneRoot, 'node_modules', ...packageName.split('/'), 'package.json');
  const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const candidateIdentity = `${packageName}@${metadata.version}`;
  const candidateLicense = licenseInventory.find(item => item.identity === candidateIdentity)?.license
    || normalizeLicense(metadata.license || metadata.licenses);
  return {
    packageName,
    version: metadata.version,
    license: candidateLicense,
    transitiveDependencies: licenseInventory
      .filter(item => item.identity !== candidateIdentity)
      .map(item => item.identity),
    licenseInventory: licenseInventory.map(item => `${item.identity}:${item.license}`),
    polyfills: ['DOMRect (probe scope only when absent)'],
  };
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function safeBuildPath(buildRoot, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const normalized = path.normalize(decoded === '/' ? '/index.html' : decoded);
  const fullPath = path.join(buildRoot, normalized);
  return fullPath.startsWith(buildRoot) ? fullPath : undefined;
}

function processTreeRssBytes(rootPid) {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  const rows = result.stdout.split(/\r?\n/).map(line => {
    const [pid, parentPid, rssKb] = line.trim().split(/\s+/).map(Number);
    return { pid, parentPid, rssKb };
  }).filter(row =>
    Number.isFinite(row.pid)
    && Number.isFinite(row.parentPid)
    && Number.isFinite(row.rssKb));
  const included = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (included.has(row.parentPid) && !included.has(row.pid)) {
        included.add(row.pid);
        changed = true;
      }
    }
  }
  return rows
    .filter(row => included.has(row.pid))
    .reduce((total, row) => total + row.rssKb * 1024, 0);
}

function classifyRunError(error) {
  const rawCode = error instanceof Error && typeof error.message === 'string'
    ? error.message
    : 'TRACE_RUN_UNKNOWN';
  const normalized = rawCode.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  if (normalized.includes('TIMEOUT') || normalized.includes('TIMED_OUT')) {
    return { category: 'timeout', code: 'TRACE_WORKER_TIMEOUT' };
  }
  if (normalized.includes('CHROMIUM_EXITED')) {
    return { category: 'crash', code: 'TRACE_CHROMIUM_EXITED' };
  }
  if (normalized.includes('WORKER') || normalized.includes('BROWSER_RESULT')) {
    return { category: 'worker', code: 'TRACE_WORKER_RUNTIME_FAILED' };
  }
  if (normalized.includes('ENGINE') || normalized.includes('SAMPLE_SHAPE')) {
    return { category: 'engine', code: 'TRACE_ENGINE_PARSE_FAILED' };
  }
  return { category: 'environment', code: 'TRACE_RUN_ENVIRONMENT_FAILED' };
}

function runBrowserProbe({ cloneRoot, chromium, sample, runIndex, tempDirectory, timeoutMs = 300_000 }) {
  return new Promise((resolve, reject) => {
    const buildRoot = path.join(cloneRoot, 'build');
    let browser;
    let settled = false;
    let memorySampler;
    let peakMemoryBytes = 0;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(memorySampler);
      if (browser && !browser.killed) browser.kill('SIGTERM');
      server.close(() => {
        setTimeout(() => {
          const postTerminationRssBytes = browser
            ? (processTreeRssBytes(browser.pid) || 0)
            : 0;
          if (error) reject(error);
          else resolve({ ...result, peakMemoryBytes, postTerminationRssBytes });
        }, 250);
      });
    };
    const server = http.createServer((request, response) => {
      if (!request.url) {
        response.writeHead(400);
        response.end();
        return;
      }
      if (request.url.startsWith('/__trace-spike-sample')) {
        const stat = fs.statSync(sample.inputRef);
        response.writeHead(200, {
          'content-type': 'application/json',
          'content-length': stat.size,
          'cache-control': 'no-store',
          ...(sample.gzip ? { 'content-encoding': 'gzip' } : {}),
        });
        fs.createReadStream(sample.inputRef).pipe(response);
        return;
      }
      if (request.url.startsWith('/__trace-spike-result') && request.method === 'POST') {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', chunk => { body += chunk; });
        request.on('end', () => {
          response.writeHead(204);
          response.end();
          try {
            finish(undefined, JSON.parse(body));
          } catch (_error) {
            finish(new Error('TRACE_BROWSER_RESULT_INVALID'));
          }
        });
        return;
      }
      const staticPath = safeBuildPath(buildRoot, request.url);
      const selected = staticPath && fs.existsSync(staticPath)
        ? staticPath
        : path.join(buildRoot, 'index.html');
      response.writeHead(200, {
        'content-type': contentType(selected),
        'cache-control': 'no-store',
      });
      fs.createReadStream(selected).pipe(response);
    });
    const timer = setTimeout(() => finish(new Error('TRACE_BROWSER_TIMEOUT')), timeoutMs + 30_000);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const query = new URLSearchParams({
        traceSpikeProbe: '1',
        sampleId: sample.id,
        runIndex: String(runIndex),
        timeoutMs: String(timeoutMs),
        sampleUrl: '/__trace-spike-sample',
      });
      const profile = fs.mkdtempSync(path.join(tempDirectory, 'chromium-profile.'));
      browser = spawn(chromium, [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-crash-reporter',
        '--no-first-run',
        `--user-data-dir=${profile}`,
        `http://127.0.0.1:${port}/?${query}`,
      ], {
        cwd: cloneRoot,
        env: { ...process.env, HOME: profile, TMPDIR: profile },
        stdio: 'ignore',
      });
      memorySampler = setInterval(() => {
        const chromiumRss = processTreeRssBytes(browser.pid);
        if (Number.isFinite(chromiumRss)) {
          const endToEndRss = chromiumRss + process.memoryUsage().rss;
          peakMemoryBytes = Math.max(peakMemoryBytes, endToEndRss);
        }
      }, 50);
      const initialChromiumRss = processTreeRssBytes(browser.pid);
      if (Number.isFinite(initialChromiumRss)) {
        peakMemoryBytes = initialChromiumRss + process.memoryUsage().rss;
      }
      browser.once('exit', () => {
        if (!settled) finish(new Error('TRACE_CHROMIUM_EXITED'));
      });
    });
  });
}

function sampleMetrics(sample) {
  const stat = fs.statSync(sample.inputRef);
  const magic = Buffer.alloc(2);
  const descriptor = fs.openSync(sample.inputRef, 'r');
  try {
    fs.readSync(descriptor, magic, 0, 2, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const gzip = magic[0] === 0x1f && magic[1] === 0x8b;
  return {
    compressedBytes: gzip ? stat.size : undefined,
    inputBytes: stat.size,
    gzip,
  };
}

function projectFactSatisfies(capability, facts) {
  if (!facts || typeof facts !== 'object') return false;
  return {
    'navigation-context': () =>
      facts.navigations?.length > 0
      && facts.navigations.every(item => item.key && item.frameKey),
    'page-milestones': () =>
      facts.milestones?.length > 0
      && facts.milestones.every(item =>
        item.navigationKey && Number.isFinite(item.relativeUs)),
    'network-lifecycle': () =>
      facts.requests?.length > 0
      && facts.requests.every(item =>
        item.requestKey && item.navigationKey && item.result),
    'network-initiators': () =>
      facts.requests?.length > 0
      && facts.requests.some(item => item.initiatorKey),
    'renderer-tasks': () =>
      facts.mainThreadTasks?.length > 0
      && facts.mainThreadTasks.every(item =>
        item.navigationKey
        && Number.isFinite(item.processId)
        && Number.isFinite(item.threadId)
        && Number.isFinite(item.durationMs)),
    'multi-process-attribution': () =>
      facts.navigations?.length > 0
      && facts.navigations.every(item =>
        item.frameKey
        && Number.isFinite(item.processId)
        && Number.isFinite(item.threadId))
      && (
        new Set(facts.navigations.map(item => item.processId)).size > 1
        || facts.navigations.some(item => item.processCount > 1)
      ),
    interactions: () =>
      facts.interactions?.length > 0
      && facts.interactions.every(item =>
        item.navigationKey
        && Number.isFinite(item.inputDelayMs)
        && Number.isFinite(item.processingMs)
        && Number.isFinite(item.presentationMs)),
    'rendering-frames': () =>
      facts.frames?.length > 0
      && facts.frames.every(item =>
        item.navigationKey && Number.isFinite(item.durationMs)),
  }[capability]?.() === true;
}

function relevantProjectFactCount(capability, facts) {
  if (!facts || typeof facts !== 'object') return 0;
  return {
    'navigation-context': facts.navigations?.length,
    'page-milestones': facts.milestones?.length,
    'network-lifecycle': facts.requests?.length,
    'network-initiators': facts.requests?.length,
    'renderer-tasks': facts.mainThreadTasks?.length,
    'multi-process-attribution': facts.navigations?.length,
    interactions: facts.interactions?.length,
    'rendering-frames': facts.frames?.length,
  }[capability] || 0;
}

function buildCapabilityResults(manifest, sampleRuns, runFailures, environmentPassed) {
  const results = {};
  for (const capability of REQUIRED_CAPABILITIES) {
    if (['worker-runtime', 'cra-jest-compatibility', 'project-fact-isolation', 'privacy-boundary'].includes(capability)) {
      results[capability] = { status: environmentPassed ? 'available' : 'environment-incompatible' };
      continue;
    }
    if (capability === 'deterministic-output') {
      const runsBySample = manifest.samples.map(sample => sampleRuns.get(sample.id) || []);
      const stable = runsBySample.every(runs =>
        runs.length === 3
        && new Set(runs.map(run => run.hash)).size === 1);
      results[capability] = { status: stable ? 'available' : 'engine-missing' };
      continue;
    }
    const positives = manifest.samples.filter(sample => sample.positiveCapabilities.includes(capability));
    const samplesMissingDeclaredFamilies = positives.filter(sample => {
      const runs = sampleRuns.get(sample.id) || [];
      if (runs.length === 0) return false;
      return runs.some(run =>
        sample.expectedEventFamilies.some(family =>
          !run.detectedEventFamilies.includes(family)));
    });
    if (samplesMissingDeclaredFamilies.length > 0) {
      results[capability] = {
        status: 'sample-missing',
        positiveSamples: positives.map(sample => sample.id),
        reasonCode: 'declared-event-family-missing',
      };
      continue;
    }
    const successful = positives.filter(sample => (sampleRuns.get(sample.id) || []).length === 3);
    if (successful.length !== positives.length) {
      const hasInfrastructureFailure = positives.some(sample =>
        (runFailures.get(sample.id) || []).some(failure =>
          ['timeout', 'crash', 'worker', 'environment'].includes(failure.category)));
      const hasEngineFailure = positives.some(sample =>
        (runFailures.get(sample.id) || []).some(failure => failure.category === 'engine'));
      results[capability] = {
        status: hasInfrastructureFailure
          ? 'environment-incompatible'
          : (hasEngineFailure ? 'engine-missing' : 'sample-missing'),
        positiveSamples: positives.map(sample => sample.id),
        reasonCode: hasInfrastructureFailure
          ? 'positive-sample-runtime-failure'
          : (hasEngineFailure ? 'positive-sample-engine-failure' : 'positive-sample-missing'),
      };
      continue;
    }
    const mapped = successful.every(sample =>
      (sampleRuns.get(sample.id) || []).every(run =>
        projectFactSatisfies(capability, run.projectFacts)));
    const hasRelevantFacts = successful.some(sample =>
      (sampleRuns.get(sample.id) || []).some(run =>
        relevantProjectFactCount(capability, run.projectFacts) > 0));
    results[capability] = {
      status: mapped ? 'available' : (hasRelevantFacts ? 'adapter-risk' : 'engine-missing'),
      positiveSamples: positives.map(sample => sample.id),
      reasonCode: mapped
        ? 'project-fact-contract-satisfied'
        : (hasRelevantFacts ? 'project-fact-contract-incomplete' : 'project-facts-missing'),
    };
  }
  for (const capability of OPTIONAL_CAPABILITIES) {
    results[capability] = { status: 'unavailable-optional', positiveSamples: [] };
  }
  return results;
}

function findMissingSamples(manifest, sampleRuns, runFailures) {
  return manifest.samples
    .filter(sample => {
      const runs = sampleRuns.get(sample.id) || [];
      const missingDeclaredFamily = runs.some(run =>
        sample.expectedEventFamilies.some(family =>
          !run.detectedEventFamilies.includes(family)));
      if (missingDeclaredFamily) return true;
      const failures = runFailures.get(sample.id) || [];
      return runs.length !== 3 && failures.some(failure => failure.category === 'sample');
    })
    .map(sample => sample.id);
}

function assessMemoryTrend(runs) {
  if (!Array.isArray(runs) || runs.length !== 3) return 'unverified';
  const peaks = runs.map(run => run.peakMemoryBytes);
  if (peaks.some(value => !Number.isFinite(value) || value <= 0)) return 'unverified';
  return peaks[0] < peaks[1] && peaks[1] < peaks[2]
    ? 'monotonic-growth'
    : 'no-monotonic-growth';
}

function summarizeRunFailures(runFailures) {
  const failures = [...runFailures.values()].flat();
  return {
    timeoutCount: failures.filter(failure => failure.category === 'timeout').length,
    crashCount: failures.filter(failure => failure.category === 'crash').length,
    engineErrorCount: failures.filter(failure => failure.category === 'engine').length,
    workerErrorCount: failures.filter(failure => failure.category === 'worker').length,
  };
}

function writeReports(report, outputDirectory) {
  const projected = projectReport(report);
  const markdown = renderMarkdownReport(projected);
  const failures = [...scanGeneratedOutput(projected), ...scanGeneratedOutput(markdown)];
  if (failures.length > 0) {
    const error = new Error('TRACE_REPORT_PRIVACY_SCAN_FAILED');
    error.failureCodes = [...new Set(failures)];
    throw error;
  }
  const jsonName = '2026-07-28-chromium-trace-engine-spike.json';
  const markdownName = '2026-07-28-chromium-trace-engine-spike.md';
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, jsonName), `${JSON.stringify(projected, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, markdownName), markdown);
  return projected;
}

async function runRealSpike(options) {
  const worktreeRoots = validateRealRunArgs(options);
  checkToolSources();
  const manifestPath = assertOutsideWorktrees(options.manifestPath, 'manifest', worktreeRoots);
  const prdPath = assertOutsideWorktrees(options.prdPath, 'PRD', worktreeRoots);
  const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  for (const sample of manifest.samples) {
    sample.inputRef = assertOutsideWorktrees(sample.inputRef, sample.id, worktreeRoots);
    Object.assign(sample, sampleMetrics(sample));
  }
  const outputDirectory = assertOutputInsideRepository(options.outputDir);
  const tempDirectory = fs.mkdtempSync(TEMP_PREFIX);
  let cleanupWarning;
  let report;
  try {
    validateCleanupTarget(tempDirectory, {
      approvedRoot: APPROVED_TEMP_ROOT,
      repositoryRoots: worktreeRoots,
    });
    const cloneRoot = path.join(tempDirectory, 'project');
    runCommand('git', ['clone', '--no-checkout', PROJECT_ROOT, cloneRoot], {
      stage: 'clone-tool-commit',
    });
    runCommand('git', ['checkout', '--detach', options.toolCommitSha], {
      cwd: cloneRoot,
      stage: 'checkout-tool-commit',
    });
    runCommand('npm', ['install', '--save-exact', `${options.enginePackage}@${options.engineVersion}`], {
      cwd: cloneRoot,
      stage: 'install-exact-engine-version',
    });
    const licenseInventory = readInstalledLicenseInventory(cloneRoot, options.enginePackage);
    const candidate = readCandidateMetadata(cloneRoot, options.enginePackage, licenseInventory);
    injectProbes(cloneRoot, options.enginePackage);
    runCommand('npm', ['test', '--', '--watchAll=false', '--runTestsByPath', 'src/upload/parseUploadedInput.test.ts'], {
      cwd: cloneRoot,
      env: { ...process.env, CI: 'true' },
      stage: 'ordinary-jest-isolation-check',
    });
    runCommand('npm', ['test', '--', '--watchAll=false', '--runTestsByPath', 'src/trace-spike-probe/trace-engine-jest.probe.test.ts'], {
      cwd: cloneRoot,
      env: { ...process.env, CI: 'true' },
      stage: 'jest-contract-probe',
    });
    runCommand('npm', ['run', 'build'], { cwd: cloneRoot, stage: 'cra-production-build' });
    const chromium = findChromium();
    const sampleRuns = new Map();
    const runFailures = new Map();
    const sampleStability = new Map();
    for (const sample of manifest.samples) {
      const runs = [];
      const failures = [];
      for (let runIndex = 1; runIndex <= 3; runIndex += 1) {
        try {
          const browserResult = await runBrowserProbe({
            cloneRoot,
            chromium,
            sample,
            runIndex,
            tempDirectory,
          });
          if (browserResult.errorCode || !browserResult.result?.parsed) {
            throw new Error(browserResult.errorCode || 'TRACE_ENGINE_PARSE_FAILED');
          }
          const bounded = {
            inputEventCount: browserResult.result.inputEventCount,
            projectFacts: browserResult.result.projectFacts || {},
          };
          runs.push({
            parseDurationMs: browserResult.parseDurationMs,
            heartbeatMaxDelayMs: browserResult.heartbeatMaxDelayMs,
            peakMemoryBytes: browserResult.peakMemoryBytes,
            postTerminationRssBytes: browserResult.postTerminationRssBytes,
            jsonBytes: browserResult.jsonBytes,
            inputEventCount: bounded.inputEventCount,
            resultBytes: Buffer.byteLength(JSON.stringify(bounded)),
            projectFacts: bounded.projectFacts,
            detectedEventFamilies: Array.isArray(browserResult.detectedEventFamilies)
              ? browserResult.detectedEventFamilies
              : [],
          });
        } catch (error) {
          failures.push({
            sampleId: sample.id,
            runIndex,
            stage: 'browser-worker-parse',
            ...classifyRunError(error),
          });
          break;
        }
      }
      if (runs.length === 3) {
        const comparison = compareStability(runs.map(run => run.projectFacts));
        runs.forEach((run, index) => {
          run.hash = comparison.hashes[index];
        });
        sampleStability.set(sample.id, comparison);
      }
      sampleRuns.set(sample.id, runs);
      runFailures.set(sample.id, failures);
    }
    const capabilities = buildCapabilityResults(
      manifest,
      sampleRuns,
      runFailures,
      true,
    );
    const missingSamples = findMissingSamples(manifest, sampleRuns, runFailures);
    const validatedMaxJsonBytes = Math.max(
      0,
      ...manifest.samples
        .filter(sample => (sampleRuns.get(sample.id) || []).length === 3)
        .map(sample => sampleRuns.get(sample.id)[0].jsonBytes),
    );
    const unresolvedLicenses = unresolvedLicenseEntries(licenseInventory);
    const unverifiedCapacity = [];
    for (const [sampleId, runs] of sampleRuns) {
      if (runs.length !== 3) continue;
      if (runs.some(run => !Number.isFinite(run.peakMemoryBytes) || run.peakMemoryBytes <= 0)) {
        unverifiedCapacity.push(`${sampleId}: peak memory unavailable`);
      }
      if (runs.some(run => run.postTerminationRssBytes !== 0)) {
        unverifiedCapacity.push(`${sampleId}: Chromium process tree remained after termination`);
      }
      if (runs.some(run => run.heartbeatMaxDelayMs > 100)) {
        unverifiedCapacity.push(`${sampleId}: main-thread heartbeat delay exceeded 100ms`);
      }
      if (assessMemoryTrend(runs) === 'monotonic-growth') {
        unverifiedCapacity.push(`${sampleId}: end-to-end peak memory grew monotonically`);
      }
    }
    const decision = decideSpike({
      capabilities,
      missingSamples,
      unresolvedLicenses,
      unverifiedCapacity,
      validatedMaxJsonBytes,
    });
    const sampleReports = manifest.samples.map(sample => {
      const runs = sampleRuns.get(sample.id) || [];
      return {
        id: sample.id,
        expectedEventFamilies: sample.expectedEventFamilies,
        positiveCapabilities: sample.positiveCapabilities,
        capacityRole: sample.capacityRole,
        compressedBytes: sample.compressedBytes,
        jsonBytes: runs[0]?.jsonBytes,
        eventCount: runs[0]?.inputEventCount,
        resultBytes: Math.max(0, ...runs.map(run => run.resultBytes)),
        parseDurationsMs: runs.map(run => run.parseDurationMs),
        peakMemoryBytes: runs.map(run => run.peakMemoryBytes),
        heartbeatMaxDelayMs: Math.max(0, ...runs.map(run => run.heartbeatMaxDelayMs)),
        status: runs.length === 3
          ? 'completed'
          : ((runFailures.get(sample.id) || []).length > 0 ? 'run-failed' : 'sample-missing'),
        runFailures: runFailures.get(sample.id) || [],
      };
    });
    const failureSummary = summarizeRunFailures(runFailures);
    report = {
      schemaVersion: 1,
      prd: {
        documentId: 'chromium-performance-trace-diagnosis-prd-and-design',
        date: '2026-07-28',
        sha256: sha256(fs.readFileSync(prdPath)),
      },
      branch: 'feat-trace-file-parsing-R51YeU',
      baselineCommitSha: runCommand('git', ['rev-parse', `${options.toolCommitSha}^`], {
        cwd: cloneRoot,
        stage: 'read-baseline-commit',
      }).stdout.trim(),
      toolCommitSha: options.toolCommitSha,
      candidate,
      environment: {
        nodeVersion: process.version,
        npmVersion: runCommand('npm', ['--version'], { cwd: cloneRoot }).stdout.trim(),
        osPlatform: process.platform,
        osReleaseMajor: os.release().split('.')[0],
      },
      methods: {
        memoryMeasurement: '50ms sum of orchestrator RSS and Chromium process-tree RSS',
        heartbeatMeasurement: '20ms page interval; maximum positive scheduling delay',
        workerIsolation: 'new Chromium profile, page, Worker, and engine instance per run',
      },
      samples: sampleReports,
      capabilities,
      stability: manifest.samples.map(sample => {
        const runs = sampleRuns.get(sample.id) || [];
        const comparison = sampleStability.get(sample.id);
        const summary = comparison?.summaries?.[0];
        return {
          sampleId: sample.id,
          stable: comparison?.stable === true,
          hashes: comparison?.hashes || [],
          navigationCount: summary?.navigationKeys?.length,
          requestCount: summary?.requestCount,
          milestoneCount: summary?.milestones?.length,
          taskCount: summary?.taskCount,
          interactionCount: summary?.interactionCount,
        };
      }),
      capacity: {
        validatedMaxJsonBytes,
        memoryTrend: sampleReports.every(sample =>
          sample.peakMemoryBytes.length === 3
          && sample.peakMemoryBytes.every(Number.isFinite))
          ? (sampleReports.some(sample =>
              assessMemoryTrend(sample.peakMemoryBytes.map(peakMemoryBytes => ({ peakMemoryBytes })))
              === 'monotonic-growth')
            ? 'monotonic-growth'
            : 'no-monotonic-growth')
          : 'unverified',
        timeoutCount: failureSummary.timeoutCount,
        crashCount: failureSummary.crashCount,
        engineErrorCount: failureSummary.engineErrorCount,
        workerErrorCount: failureSummary.workerErrorCount,
      },
      privacy: {
        allowlistProjectionPassed: true,
        generatedOutputScanPassed: true,
        toolStaticCheckPassed: true,
        failureCodes: [],
      },
      decision,
    };
  } finally {
    try {
      removeValidatedTempDirectory(tempDirectory, {
        approvedRoot: APPROVED_TEMP_ROOT,
        repositoryRoots: worktreeRoots,
      });
    } catch (_error) {
      cleanupWarning = 'cleanup-warning';
    }
    if (cleanupWarning) {
      process.stderr.write('Trace Spike warning: cleanup-warning; manual cleanup is required.\n');
    }
  }
  report.cleanup = cleanupWarning
    ? { status: 'cleanup-warning', warningCode: 'temporary-directory-remove-failed' }
    : { status: 'removed' };
  return writeReports(report, outputDirectory);
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.dryRun) await runDryRun();
    else await runRealSpike(options);
  } catch (error) {
    process.stderr.write(`Trace Spike failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
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
  normalizeLicense,
  parseWorktreeRoots,
  parseArgs,
  projectFactSatisfies,
  readInstalledLicenseInventory,
  renderMarkdownReport,
  runRealSpike,
  summarizeRunFailures,
  unresolvedLicenseEntries,
  validateCommitSha,
  validateExactVersion,
  validatePackageName,
  writeReports,
};
