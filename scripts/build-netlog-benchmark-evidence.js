#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function argValues(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && process.argv[i + 1]) values.push(process.argv[i + 1]);
  }
  return values;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage() {
  console.error('Usage: npm run benchmark:evidence -- --input metrics-a.json --input metrics-b.json [--output evidence.json]');
}

function readMetrics(filePath) {
  const absolutePath = path.resolve(filePath);
  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.metrics)) return parsed.metrics;
  if (parsed && parsed.packageVersion === 'netlog-benchmark-evidence-v1') {
    throw new Error(`${filePath} is already an evidence package; pass raw benchmark metric JSON instead.`);
  }
  return [parsed];
}

const inputs = argValues('--input');
const output = argValue('--output');

if (inputs.length === 0) {
  usage();
  process.exit(1);
}

const projectRoot = path.join(__dirname, '..');
const tempTestPath = path.join(projectRoot, 'src', 'benchmark', 'netlogBenchmarkEvidencePackage.tmp.test.ts');
const marker = 'NETLOG_BENCHMARK_EVIDENCE_PACKAGE ';

let metrics;
try {
  metrics = inputs.flatMap(readMetrics);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const testSource = `
import { buildNetlogBenchmarkEvidencePackage } from './netlogBenchmarkEvidencePackage';
import type { NetlogBenchmarkMetricInput } from './netlogBenchmarkEvidencePackage';

describe('netlog benchmark evidence package cli', () => {
  it('builds evidence package from benchmark metrics', () => {
    const metrics: NetlogBenchmarkMetricInput[] = ${JSON.stringify(metrics)};
    const evidence = buildNetlogBenchmarkEvidencePackage(metrics);
    console.log(${JSON.stringify(marker)} + JSON.stringify(evidence));
    expect(evidence.metricCount).toBe(metrics.length);
  });
});
`;

try {
  fs.writeFileSync(tempTestPath, testSource);
  const reactScripts = path.join(projectRoot, 'node_modules', 'react-scripts', 'bin', 'react-scripts.js');
  const result = spawnSync(process.execPath, [reactScripts, 'test', '--watchAll=false', '--runTestsByPath', tempTestPath], {
    cwd: projectRoot,
    env: { ...process.env, CI: 'true' },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });
  const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
  const line = combinedOutput.split(/\r?\n/).find(item => item.includes(marker));
  if (!line) {
    process.stderr.write(combinedOutput);
    process.exitCode = result.status || 1;
  } else {
    const evidence = JSON.parse(line.slice(line.indexOf(marker) + marker.length));
    const formatted = JSON.stringify(evidence, null, 2);
    if (output) {
      fs.writeFileSync(path.resolve(output), `${formatted}\n`);
    } else {
      console.log(formatted);
    }
    process.exitCode = result.status || 0;
  }
} finally {
  if (fs.existsSync(tempTestPath)) fs.unlinkSync(tempTestPath);
}
