// Offline synthetic acceptance support. Never opens apps or reads external samples.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createRequire } = require('module');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../..');
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
const { buildNetlogJsonExport, buildNetlogCsvExport } = taskRequire('./src/utils/netlogExport');
const Ajv = taskRequire('ajv');
const validate = new Ajv({ allErrors: true }).compile(JSON.parse(fs.readFileSync(
  path.join(__dirname, 'review-c-sharing-v1.schema.json'), 'utf8',
)));
const timestamp = new Date('2026-11-11T00:00:00.000Z');
const netlogInput = {
  constants: {
    logEventTypes: { URL_REQUEST_ALIVE: 1, URL_REQUEST_START_JOB: 2 },
    logSourceType: { URL_REQUEST: 1 },
  },
  events: Array.from({ length: 150 }, (_, index) => {
    const source = { id: index + 1, type: 1 };
    return [
      { time: String(index * 10), type: 1, phase: 1, source, params: {} },
      { time: String(index * 10), type: 2, phase: 0, source,
        params: { url: `https://example.test/request/${index}?token=SYNTHETIC_ONLY`, method: 'GET' } },
      { time: String(index * 10 + 5), type: 1, phase: 2, source, params: {} },
    ];
  }).flat(),
};
const logInput = Array.from({ length: 120 }, (_, index) =>
  `[synthetic] Info 2026-11-11 00:00:01 Got Success 200 GET:https://example.test/request/${index} | header -> authorization=SYNTHETIC_ONLY | body -> null | +0ms`,
).join('\n') + '\n';
const result = parseLog(netlogInput).result;
const entries = parseLogFile(logInput).entries;
assert.strictEqual(result.urlRequests.length, 150);
assert.strictEqual(entries.length, 120);
const outputs = {
  'synthetic-netlog.json': JSON.stringify(netlogInput, null, 2) + '\n',
  'synthetic-go.log': logInput,
  'netlog-safe-v1.json': buildNetlogJsonExport(result, false, timestamp),
  'netlog-expert-legacy.json': buildNetlogJsonExport(result, true, timestamp),
  'go-safe-v1.json': buildLogEntriesJson(entries, false, timestamp),
  'go-expert-legacy.json': buildLogEntriesJson(entries, true, timestamp),
};
let assertions = 0;
function check(run) { run(); assertions += 1; }
function safeConsumer(payload) {
  assert.strictEqual(validate(payload), true);
  return payload.kind === 'go' ? payload.data.entries : payload.data.requests;
}
// Minimal legacy root consumer; this is a contract probe, not a real downstream app.
function legacyConsumer(payload, kind) {
  assert(!Object.prototype.hasOwnProperty.call(payload, 'schema'));
  assert(typeof payload.exportTime === 'string');
  return kind === 'go' ? payload.entries : payload.requests;
}
for (const [kind, count] of [['netlog', 150], ['go', 120]]) {
  const safe = JSON.parse(outputs[`${kind}-safe-v1.json`]);
  const expert = JSON.parse(outputs[`${kind}-expert-legacy.json`]);
  check(() => assert.strictEqual(safeConsumer(safe).length, count));
  check(() => assert.strictEqual(legacyConsumer(expert, kind).length, count));
  check(() => assert.throws(() => legacyConsumer(safe, kind)));
  check(() => assert.throws(() => safeConsumer(expert)));
  check(() => assert.throws(() => safeConsumer({ ...safe, version: 2 })));
  check(() => assert(!JSON.stringify(safe).includes('SYNTHETIC_ONLY')));
}
const goSafe = JSON.parse(outputs['go-safe-v1.json']).data;
check(() => assert.deepStrictEqual(goSafe.entries.map(e => e.id), entries.map(e => e.id)));
check(() => assert.deepStrictEqual(goSafe.identity, { scope: 'analysis-local', crossFileUnique: false }));
check(() => assert.deepStrictEqual(JSON.parse(outputs['go-expert-legacy.json']).entries,
  JSON.parse(JSON.stringify(entries))));
const csvCases = [
  { value: '=1+1', protected: true }, { value: '+1+1', protected: true },
  { value: '-1+1', protected: true }, { value: '@SUM(1)', protected: true },
  { value: ' \t=1+1', protected: true }, { value: '\ttext', protected: true },
  { value: '\rtext', protected: true }, { value: '\ntext', protected: true },
  { value: '中文,"quoted"\nnext', protected: false },
  { value: 'plain', protected: false },
];
const csvResult = {
  ...result, urlRequests: csvCases.map((item, index) => ({
    ...result.urlRequests[index], method: item.value, status: item.value,
    statusCode: 0, duration: 0, error: -106,
  })),
};
outputs['excel-safety-synthetic.csv'] = buildNetlogCsvExport(csvResult, true);
outputs['csv-expected.json'] = JSON.stringify({
  columns: 12, cases: csvCases, expectedNumericCells: ['0', '0', '-106'],
  note: 'Synthetic expert CSV is used to preserve each formula-prefix input while retaining formula protection.',
}, null, 2) + '\n';
// Preserve exact CR/LF fixture bytes in an archive rather than normalizing CSV for Git.
outputs['excel-safety-synthetic.csv.zip'] = execFileSync('python3', ['-c', [
  'import sys,io,zipfile',
  'buffer=io.BytesIO()',
  'archive=zipfile.ZipFile(buffer,"w",compression=zipfile.ZIP_DEFLATED)',
  'item=zipfile.ZipInfo("excel-safety-synthetic.csv",date_time=(1980,1,1,0,0,0))',
  'item.compress_type=zipfile.ZIP_DEFLATED',
  'archive.writestr(item,sys.stdin.buffer.read())',
  'archive.close()',
  'sys.stdout.buffer.write(buffer.getvalue())',
].join('\n')], { input: outputs['excel-safety-synthetic.csv'] });
delete outputs['excel-safety-synthetic.csv'];
const target = path.join(__dirname, 'runtime-fixtures');
for (const [name, content] of Object.entries(outputs)) {
  const file = path.join(target, name);
  if (process.argv.includes('--write')) fs.writeFileSync(file, content);
  if (Buffer.isBuffer(content)) assert(fs.readFileSync(file).equals(content));
  else assert.strictEqual(fs.readFileSync(file, 'utf8'), content);
}
console.log(JSON.stringify({
  status: 'passed', scope: 'synthetic-contract-probes-only', assertions,
  filesVerified: Object.keys(outputs).length, netlogRequests: 150, goEntries: 120,
  actualBrowser: 'not-run', actualExcel: 'not-run', realSamples: 'not-run', realConsumers: 'not-run',
}));
