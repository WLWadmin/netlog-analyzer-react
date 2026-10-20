/* Opt-in local acceptance. Never print sample paths, values or exception text. */
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

if (!process.env.HAR_RECOVERY_SAMPLE_PATH) {
  console.log(JSON.stringify({ status: 'not-run', reason: 'HAR_RECOVERY_SAMPLE_PATH is required' }));
  process.exitCode = 2;
} else if (process.argv[2] !== '--child') {
  // OS file access can stall before returning an error. Bound the whole run and
  // suppress child stderr so neither OS errors nor assertion diffs leak data.
  const child = fork(__filename, ['--child'], { stdio: ['ignore', 'pipe', 'ignore', 'ipc'] });
  child.stdout.pipe(process.stdout);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
    console.log(JSON.stringify({ status: 'blocked', reason: 'local sample acceptance exceeded 60 seconds' }));
  }, 60000);
  child.on('exit', code => {
    clearTimeout(timer);
    process.exitCode = timedOut ? 2 : (code ?? 1);
  });
} else {
  const ts = require('typescript');
  require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    });
    module._compile(compiled.outputText, filename);
  };
  let stage = 'loading-parser';
  let counts;
  const check = (condition, name) => {
    stage = name;
    if (!condition) throw new Error(name);
  };
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  (async () => {
    const { parseHarInput } = require(path.join(__dirname, '../src/utils/parseHarInput.ts'));
    const { loadHarResponseBody } = require(path.join(__dirname, '../src/components/har/harResponseBodyGateway.ts'));
    stage = 'reading-local-sample';
    const original = fs.readFileSync(process.env.HAR_RECOVERY_SAMPLE_PATH);
    const beforeHash = hash(original);
    const raw = original.toString('utf8');
    let invalid = false;
    try { JSON.parse(raw); } catch { invalid = true; }
    check(invalid, 'original-json-invalid');
    stage = 'recovering-har';
    const { result, rawData } = parseHarInput(raw);
    const info = result.repairInfo;
    counts = {
      total: info?.totalEntries, retained: result.entries.length,
      structure: info?.structureIncompleteEntries, syntax: info?.syntaxDamagedEntries,
      unknownRanges: info?.unknownRanges,
    };
    check(info?.totalEntriesExact === true && info.totalEntries === 694, 'exact-block-count');
    check(result.entries.length === 692, 'retained-count');
    check(info.structureIncompleteEntries === 1 && info.syntaxDamagedEntries === 1, 'excluded-counts');
    check(info.excludedEntries.some(item => item.originalEntryIndex === 74 && item.kind === 'structure' && item.reason.includes('response')), 'missing-response-position');
    check(info.excludedEntries.some(item => item.originalEntryIndex === 102 && item.kind === 'syntax'), 'syntax-position');
    check(!Object.hasOwn(info, 'data'), 'compact-report');
    for (const index of [0, 73, 75, 101, 103, 693]) {
      const retained = result.entries.find(item => item.sourceLocation?.originalEntryIndex === index);
      check(Boolean(retained), 'both-sides-retained');
      const source = retained.sourceLocation;
      const originalEntry = JSON.parse(raw.slice(source.charStart, source.charEnd));
      check(originalEntry.request.url === retained.url, 'original-request-mapping');
      check(rawData.log.entries[retained.id].request.url === originalEntry.request.url, 'logical-array-mapping');
    }
    const deferred = result.entries.filter(item =>
      item.sourceLocation.originalEntryIndex > 102 && item.responseBodyDescriptor?.state === 'deferred');
    check(deferred.length > 0, 'late-deferred-body-exists');
    for (const retained of deferred) {
      const source = retained.sourceLocation;
      const originalEntry = JSON.parse(raw.slice(source.charStart, source.charEnd));
      const body = await loadHarResponseBody({ rawData }, retained);
      check(body.text === originalEntry.response.content.text, 'deferred-body-mapping');
    }
    check(hash(fs.readFileSync(process.env.HAR_RECOVERY_SAMPLE_PATH)) === beforeHash, 'original-unchanged');
    console.log(JSON.stringify({
      status: 'passed', total: info.totalEntries, retained: result.entries.length,
      structure: info.structureIncompleteEntries, syntax: info.syntaxDamagedEntries,
      deferredBodiesChecked: deferred.length, originalUnchanged: true,
    }));
  })().catch(() => {
    console.log(JSON.stringify({ status: 'failed', stage, ...counts }));
    process.exitCode = 1;
  });
}
