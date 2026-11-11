// Synthetic DTO + React/JSDOM measurement; deliberately never starts a browser.
const fs = require('fs');
const Module = require('module');
const { performance } = require('perf_hooks');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'antd') return {
    Button: ({ children, onClick }) => React.createElement('button', { onClick }, children),
    Modal: ({ children, footer }) => React.createElement('div', { role: 'dialog' }, children, footer),
    message: { success() {}, error() {} },
  };
  return originalLoad.call(this, request, parent, isMain);
};
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
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
const exported = measure(() => buildNetlogJsonExport(result, new Date(0)));
const csv = measure(() => buildNetlogCsvExport(result));
const heapExported = heap();
let controls;
function Harness({ owner }) {
  controls = useExportPreview(owner);
  return controls.exportPreview;
}
const root = createRoot(document.getElementById('root'));
React.act(() => root.render(React.createElement(Harness, { owner: result })));
const job = { filename: 'synthetic.json', mime: 'application/json', text: exported.value };
const open = measure(() => React.act(() => controls.openExportPreview(job)));
const previewChars = document.querySelector('textarea').value.length;
const heapOpen = heap();
const cancel = measure(() => React.act(() => [...document.querySelectorAll('button')]
  .find(button => button.textContent === '取消').click()));
const heapCancel = heap();
React.act(() => controls.openExportPreview(job));
const reset = measure(() => React.act(() => root.render(React.createElement(Harness, { owner: {} }))));
const invalidated = !document.querySelector('textarea');
React.act(() => root.unmount());
console.log(JSON.stringify({
  benchmark: 'synthetic-export-react-jsdom', mode: 'diagnostic-working-tree',
  count, node: process.version, gc: Boolean(global.gc),
  jsonChars: exported.value.length, csvChars: csv.value.length, previewChars,
  ms: { jsonBuild: exported.ms, csvBuild: csv.ms, open: open.ms,
    cancel: cancel.ms, ownerReset: reset.ms },
  heapBytes: { start: heapStart, jsonAndCsv: heapExported, open: heapOpen, cancel: heapCancel },
  ownerInvalidated: invalidated,
  note: 'Node/JSDOM single-run observations, not Edge layout, Blob download, or real 500/800MB performance.',
}, null, 2));
dom.window.close();
Module._load = originalLoad;
