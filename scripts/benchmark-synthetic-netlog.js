#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const count = Number(process.argv[2] || 50000);
const output = path.join(os.tmpdir(), `synthetic-netlog-${count}.json`);

const generateStart = Date.now();
const generate = spawnSync(process.execPath, [path.join(__dirname, 'generate-synthetic-netlog.js'), output, String(count)], {
  encoding: 'utf8',
});
if (generate.status !== 0) {
  process.stderr.write(generate.stderr || generate.stdout);
  process.exit(generate.status || 1);
}
const generateMs = Date.now() - generateStart;
const bytes = fs.statSync(output).size;

console.log(JSON.stringify({
  benchmark: 'synthetic-netlog-generation',
  count,
  bytes,
  generateMs,
  output,
  note: '该脚本当前只验证 synthetic NetLog 生成耗时；Worker index benchmark 需在浏览器环境接入。',
}, null, 2));
