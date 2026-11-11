// Synthetic DTO + React/JSDOM measurement; deliberately never starts a browser.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Module = require('module');
const { performance } = require('perf_hooks');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const baseline = process.argv[3] === '--baseline';
const baselineSha = '0d1581aff49ee143e7cd3185152c591264129ca5';
const repoRoot = path.resolve(__dirname, '..');
const baselineFiles = new Set([
  'src/utils/netlogExport.ts', 'src/diagnosis/shared/maskedExport.ts',
  'src/components/shared/useExportPreview.tsx',
]);

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'antd') return {
    Button: ({ children, onClick }) => React.createElement('button', { onClick }, children),
    Checkbox: ({ children, checked, onChange }) => React.createElement('label', null,
      React.createElement('input', { type: 'checkbox', checked, onChange }), children),
    Modal: ({ children, footer }) => React.createElement('div', { role: 'dialog' }, children, footer),
    message: { success() {}, error() {} },
  };
  return originalLoad.call(this, request, parent, isMain);
};
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const relative = path.relative(repoRoot, filename);
    const source = baseline && baselineFiles.has(relative)
      ? execFileSync('git', ['show', `${baselineSha}:${relative}`], { cwd: repoRoot, encoding: 'utf8' })
      : fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      fileName: filename, compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
      },
    });
    module._compile(outputText, filename);
  };
}
const { buildNetlogJsonExport, buildNetlogCsvExport } = require('../src/utils/netlogExport');
const { useExportPreview } = require('../src/components/shared/useExportPreview');
const dom = new JSDOM('<div id="root"></div>');
const document = dom.window.document;
global.window = dom.window;
global.document = document;
global.navigator = dom.window.navigator;
global.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require('react-dom/client');
const count = Number(process.argv[2] || 10000);
if (!Number.isSafeInteger(count) || count < 1 || count > 100000) throw new Error('count must be 1..100000');
const result = {
  totalEvents: count * 4, uniqueSources: count, peakConcurrency: 100,
  proxyInfo: { hasProxy: false, proxyType: null, proxySettings: null, effectiveProxy: null,
    originalProxy: null, pacUrl: null, proxyList: [], proxyFallback: null, isVPN: false, vpnHints: [] },
  urlRequests: Array.from({ length: count }, (_, index) => ({
    url: `https://synthetic.example.test/request/${index}?debug=synthetic`,
    method: 'GET', status: 'success', statusCode: 200, duration: index % 1000, error: 0,
    timeline: { wait: { start: 0, end: 10, duration: 10 } },
  })), errors: [], warnings: [], slowRequests: [],
};
const measure = (run) => {
  const start = performance.now();
  const value = run();
  return { value, ms: +(performance.now() - start).toFixed(2) };
};
const heap = () => {
  if (global.gc) global.gc();
  return process.memoryUsage().heapUsed;
};
const heapStart = heap();
const sharing = measure(() => buildNetlogJsonExport(result, false, new Date(0)));
const csv = measure(() => buildNetlogCsvExport(result));
const heapSharing = heap();
let controls;
let expertMs = 0;
function Harness({ owner }) {
  controls = useExportPreview(owner);
  return controls.exportPreview;
}
const root = createRoot(document.getElementById('root'));
React.act(() => root.render(React.createElement(Harness, { owner: result })));
const open = measure(() => React.act(() => controls.openExportPreview({
  filename: 'synthetic.json', mime: 'application/json', sharingText: sharing.value,
  buildExpertText: () => {
    const built = measure(() => buildNetlogJsonExport(result, true, new Date(0)));
    expertMs = built.ms;
    return built.value;
  },
})));
const previewChars = document.querySelector('textarea').value.length;
const heapOpen = heap();
const toggle = () => document.querySelector('input').click();
const expert = measure(() => React.act(toggle));
const heapExpert = heap();
const shareAgain = measure(() => React.act(toggle));
const heapAfterShare = heap();
const cancel = measure(() => React.act(() => [...document.querySelectorAll('button')]
  .find(button => button.textContent === '取消').click()));
const heapCancel = heap();
React.act(() => controls.openExportPreview({ filename: 'synthetic.json', mime: 'application/json', sharingText: sharing.value }));
const reset = measure(() => React.act(() => root.render(React.createElement(Harness, { owner: {} }))));
const invalidated = !document.querySelector('textarea');
React.act(() => root.unmount());
console.log(JSON.stringify({
  benchmark: 'synthetic-export-react-jsdom', mode: baseline ? 'reviewed-baseline' : 'working-tree',
  baselineSha, count, node: process.version, gc: Boolean(global.gc),
  jsonChars: sharing.value.length, csvChars: csv.value.length, previewChars,
  ms: { sharingBuild: sharing.ms, csvBuild: csv.ms, open: open.ms,
    expertBuild: expertMs, expertSwitch: expert.ms, sharingSwitch: shareAgain.ms,
    cancel: cancel.ms, ownerReset: reset.ms },
  heapBytes: { start: heapStart, sharingAndCsv: heapSharing, open: heapOpen,
    expert: heapExpert, sharingAgain: heapAfterShare, cancel: heapCancel },
  ownerInvalidated: invalidated,
  note: 'Node/JSDOM single-run observations, not Edge layout, Blob download, or real 500/800MB performance.',
}, null, 2));
dom.window.close();
Module._load = originalLoad;
