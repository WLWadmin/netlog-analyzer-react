// Local synthetic builder verification; no network, browser or user files.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '../..');
const { createRequire } = require('module');
const taskRequire = createRequire(path.join(root, 'package.json'));
const ts = taskRequire('typescript');
require.extensions['.ts'] = (module, filename) => {
  assert(filename.startsWith(path.join(root, 'src') + path.sep));
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, filename);
};
process.env.TZ = 'Asia/Shanghai';
const { parseLogFile } = taskRequire('./src/logParser');
const { parseLog } = taskRequire('./src/parsers/netlog/parser');
const { buildLogEntriesJson } = taskRequire('./src/components/log/exportLogEntries');
const { buildNetlogJsonExport } = taskRequire('./src/utils/netlogExport');
const Ajv = taskRequire('ajv');
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'review-c-sharing-v1.schema.json'), 'utf8'));
const historical = JSON.parse(fs.readFileSync(path.join(__dirname, 'review-c-examples.json'), 'utf8'));
const validate = new Ajv({ allErrors: true }).compile(schema);
const generatedAt = new Date('2026-11-11T00:00:00.000Z');
const entries = parseLogFile([
  '[w1] Info 2026-11-11 00:00:00 Got Success 200 GET:https://example.test/a | +0ms',
  '[w1] Info 2026-11-11 00:00:01 Got Success 200 GET:https://example.test/b | body -> | +0ms',
].join('\n')).entries;
const result = parseLog({ events: [
  { time: '0', type: 1, phase: 0, source: { id: 1, type: 1 }, params: {} },
] }).result;
result.proxyInfo.proxySettings = null;
Reflect.deleteProperty(result.proxyInfo, 'effectiveProxy');
result.proxyInfo.originalProxy = { private: 'SYNTHETIC_PRIVATE' };
const actualNetlog = JSON.parse(buildNetlogJsonExport(result, false, generatedAt));
const actualGo = JSON.parse(buildLogEntriesJson([entries[1]], false, generatedAt));
assert.strictEqual(validate(actualNetlog), true);
assert.strictEqual(validate(actualGo), true);
const expertNetlog = JSON.parse(buildNetlogJsonExport(result, true, generatedAt));
const expertGo = JSON.parse(buildLogEntriesJson([entries[1]], true, generatedAt));
assert.deepStrictEqual(expertNetlog.proxyInfo, result.proxyInfo);
assert.deepStrictEqual(expertGo.entries[0], JSON.parse(JSON.stringify(entries[1])));
assert.strictEqual(actualGo.data.entries[0].id, 'entry-2');
assert.strictEqual(actualGo.data.entries[0].timestamp, entries[1].timestamp);
const evidence = {
  status: 'ACTUAL_SYNTHETIC_BUILDERS', reviewedBeforeHead: historical.reviewedHead,
  note: 'After code identity is the containing commit. Synthetic examples only; no real sample acceptance.',
  exampleTimeZone: 'Asia/Shanghai',
  netlogBefore: historical.netlogComparison.currentShareFragment,
  goBefore: historical.goComparison.currentShareFragment,
  actualNetlog, actualGo, expertNetlog, expertGo,
};
const target = path.join(__dirname, 'review-c-actual-examples.json');
if (process.argv.includes('--write')) fs.writeFileSync(target, JSON.stringify(evidence, null, 2) + '\n');
assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, 'utf8')), evidence);
console.log('passed: actual builders/schema, expert values, IDs/times and reproducible synthetic JSON comparison');
