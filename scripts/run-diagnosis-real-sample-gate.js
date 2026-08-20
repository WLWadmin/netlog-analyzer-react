#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const automatedAreas = [
  {
    area: 'har',
    environmentVariables: ['RUN_HAR_REAL_SAMPLES', 'HAR_REAL_SAMPLE_DIR'],
    testPaths: ['src/harParser.real-samples.test.ts'],
  },
  {
    area: 'netlog',
    environmentVariables: ['NETLOG_PARITY_SAMPLE_DIR'],
    testPaths: ['src/parsers/netlog/parityComparator.real.test.ts'],
  },
  {
    area: 'trace',
    environmentVariables: [
      'TRACE_SAMPLE_MANIFEST_PATH',
      'TRACE_PLAIN_SAMPLE_PATH',
      'TRACE_GZIP_SAMPLE_PATH',
    ],
    testPaths: [
      'src/benchmark/traceBatch6RealSamples.test.ts',
      'src/parsers/trace/readTraceFile.real-samples.test.ts',
    ],
  },
];

const artifactAreas = [
  { area: 'combined', environmentVariable: 'DIAGNOSIS_COMBINED_SAMPLE_MANIFEST_PATH' },
  { area: 'large-file', environmentVariable: 'DIAGNOSIS_LARGE_FILE_SAMPLE_MANIFEST_PATH' },
  { area: 'acceptance', environmentVariable: 'DIAGNOSIS_ACCEPTANCE_RECORD_PATH' },
];

function configured(name) {
  if (name === 'RUN_HAR_REAL_SAMPLES') return process.env[name] === '1';
  return typeof process.env[name] === 'string' && process.env[name].trim().length > 0;
}

function redact(output) {
  let sanitized = String(output || '');
  for (const name of [...new Set([
    ...automatedAreas.flatMap(area => area.environmentVariables),
    ...artifactAreas.map(area => area.environmentVariable),
  ])]) {
    const value = process.env[name];
    if (value) sanitized = sanitized.split(value).join('<REDACTED>');
  }
  return sanitized;
}

function runAutomatedArea(definition) {
  const missingEnvironmentVariables = definition.environmentVariables.filter(
    name => !configured(name),
  );
  if (missingEnvironmentVariables.length > 0) {
    return {
      area: definition.area,
      configured: false,
      executed: false,
      passed: false,
      missingEnvironmentVariables,
    };
  }

  const result = childProcess.spawnSync(npmCommand, [
    'test',
    '--',
    '--watchAll=false',
    '--runInBand',
    '--runTestsByPath',
    ...definition.testPaths,
  ], {
    cwd: root,
    env: { ...process.env, CI: 'true' },
    encoding: 'utf8',
  });
  const passed = result.status === 0;
  if (!passed) {
    const diagnostic = redact(`${result.stdout || ''}\n${result.stderr || ''}`).trim();
    if (diagnostic) process.stderr.write(`${diagnostic}\n`);
  }
  return {
    area: definition.area,
    configured: true,
    executed: true,
    passed,
    missingEnvironmentVariables: [],
  };
}

function validArtifact(value, expectedArea) {
  return Boolean(value
    && value.area === expectedArea
    && value.executed === true
    && value.passed === true
    && Array.isArray(value.cases)
    && value.cases.length > 0
    && value.cases.every(item => (
      item
      && typeof item.id === 'string'
      && item.id.trim().length > 0
      && item.passed === true
      && Array.isArray(item.expectedFacts)
      && Array.isArray(item.forbiddenConclusions)
    )));
}

function readArtifactArea(definition) {
  const missingEnvironmentVariables = configured(definition.environmentVariable)
    ? []
    : [definition.environmentVariable];
  if (missingEnvironmentVariables.length > 0) {
    return {
      area: definition.area,
      configured: false,
      executed: false,
      passed: false,
      missingEnvironmentVariables,
    };
  }

  let passed = false;
  try {
    const artifact = JSON.parse(fs.readFileSync(process.env[definition.environmentVariable], 'utf8'));
    passed = validArtifact(artifact, definition.area);
  } catch (_error) {
    passed = false;
  }
  return {
    area: definition.area,
    configured: true,
    executed: true,
    passed,
    missingEnvironmentVariables: [],
  };
}

function main() {
  const areas = [
    ...automatedAreas.map(runAutomatedArea),
    ...artifactAreas.map(readArtifactArea),
  ];
  const report = {
    passed: areas.every(area => area.passed),
    configuredAreaCount: areas.filter(area => area.configured).length,
    executedAreaCount: areas.filter(area => area.executed).length,
    passedAreaCount: areas.filter(area => area.passed).length,
    requiredAreaCount: areas.length,
    areas,
  };

  const reportPath = process.env.DIAGNOSIS_REAL_SAMPLE_GATE_REPORT_PATH;
  if (reportPath) {
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { validArtifact };
