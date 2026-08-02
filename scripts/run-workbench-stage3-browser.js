#!/usr/bin/env node

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..');
const browserStage = Number(process.env.WORKBENCH_BROWSER_STAGE ?? 3);
const stage4Mode = browserStage >= 4;
const stage5Mode = browserStage >= 5;
const artifactStage = `stage${browserStage}`;
const buildDir = path.resolve(process.env[
  `WORKBENCH_STAGE${browserStage}_BUILD_DIR`
] ?? `/tmp/netlog-workbench-${artifactStage}-product-build`);
const reportDir = path.resolve(process.env[
  `WORKBENCH_STAGE${browserStage}_REPORT_DIR`
]
  ?? path.join(root, 'docs/superpowers/reports'));
const port = Number(process.env[
  `WORKBENCH_STAGE${browserStage}_PORT`
] ?? (4180 + browserStage));
const debugPort = 9222 + browserStage;
const flagOffBuildDir = `/tmp/netlog-workbench-${artifactStage}-flag-off-build`;
const chromePath = process.env.CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const eventCounts = [100_000, 500_000, 1_000_000];
const command = `node scripts/run-workbench-${artifactStage}-browser.js`;
const warmupCount = 5;
const validRunCount = 10;
const totalRunCount = warmupCount + validRunCount;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForExit(process) {
  if (!process || process.exitCode !== null) return Promise.resolve();
  return Promise.race([
    new Promise(resolve => process.once('exit', resolve)),
    sleep(2_000),
  ]);
}

function percentile(samples, ratio) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function timing(samples) {
  const normalized = samples.map(value => Number(value.toFixed(3)));
  return {
    samplesMs: normalized,
    p50Ms: percentile(normalized, 0.5),
    p95Ms: percentile(normalized, 0.95),
  };
}

function workingTreeDiffHash() {
  const files = childProcess.execFileSync(
    'git',
    ['ls-files', '--modified', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' },
  ).split('\n')
    .filter(Boolean)
    .filter(file => (
      file === 'package.json'
      || file.startsWith('src/')
      || file.startsWith('scripts/')
    ))
    .sort();
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function buildProductBenchmark() {
  const head = childProcess.execFileSync(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: root, encoding: 'utf8' },
  ).trim();
  childProcess.execFileSync('npm', ['run', 'build'], {
    cwd: root,
    env: {
      ...process.env,
      DISABLE_ESLINT_PLUGIN: 'true',
      PUBLIC_URL: '/',
      BUILD_PATH: buildDir,
      REACT_APP_ENABLE_WORKBENCH_BENCHMARK: '1',
      REACT_APP_ENABLE_TRACE_WORKBENCH: '1',
      REACT_APP_ENABLE_TRACE_TIMELINE: '1',
      REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS: '1',
      REACT_APP_ENABLE_TRACE_CROSS_SOURCE: stage4Mode ? '1' : '0',
      REACT_APP_ENABLE_TRACE_STAGE5: stage5Mode ? '1' : '0',
      REACT_APP_WORKBENCH_BENCHMARK_REF: `${head}+${artifactStage}-working-tree`,
    },
    stdio: 'inherit',
  });
}

function buildFlagOffBenchmark() {
  if (!stage4Mode) return;
  childProcess.execFileSync('npm', ['run', 'build'], {
    cwd: root,
    env: {
      ...process.env,
      DISABLE_ESLINT_PLUGIN: 'true',
      PUBLIC_URL: '/',
      BUILD_PATH: flagOffBuildDir,
      REACT_APP_ENABLE_WORKBENCH_BENCHMARK: '1',
      REACT_APP_ENABLE_TRACE_WORKBENCH: '1',
      REACT_APP_ENABLE_TRACE_TIMELINE: '1',
      REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS: '1',
      REACT_APP_ENABLE_TRACE_CROSS_SOURCE: stage5Mode ? '1' : '0',
      REACT_APP_ENABLE_TRACE_STAGE5: '0',
      REACT_APP_WORKBENCH_BENCHMARK_REF: stage5Mode
        ? 'stage5-off'
        : 'stage4-cross-source-off',
    },
    stdio: 'inherit',
  });
}

function getJson(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1',
      port: debugPort,
      path: urlPath,
    }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

async function runCrossSourceChecks(cdp) {
  await cdp.evaluate(`Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.includes('管理来源')).click()`);
  const dispatchFile = async (label, name, value) => cdp.evaluate(`(() => {
    const input = document.querySelector(
      'input[aria-label=${JSON.stringify(label)}]'
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File(
      [JSON.stringify(${JSON.stringify(value)})],
      ${JSON.stringify(name)},
      { type: 'application/json' },
    ));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const harEntry = (id, milliseconds, method = 'GET') => ({
    pageref: 'navigation-1',
    startedDateTime: `2026-08-02T00:00:00.${String(milliseconds).padStart(3, '0')}Z`,
    time: 10,
    request: {
      method,
      url: `https://api.example.test/resource-${id}?token=<REDACTED>`,
      headers: [],
      queryString: [{ name: 'token', value: '<REDACTED>' }],
    },
    response: {
      status: 200,
      statusText: 'OK',
      headers: [],
      content: { size: 0, mimeType: 'application/json' },
    },
    timings: {
      blocked: 0, dns: 1, connect: 1, ssl: 1,
      send: 1, wait: 5, receive: 1,
    },
    _initiator: { requestId: String(id) },
  });
  await dispatchFile('追加 HAR 文件', 'synthetic.har', {
    log: {
      creator: { name: 'stage4-synthetic' },
      pages: [{
        id: 'navigation-1',
        startedDateTime: '2026-08-02T00:00:00.000Z',
        pageTimings: {},
      }],
      entries: [harEntry(1, 100), harEntry(2, 200)],
    },
  });
  await cdp.waitFor(
    `document.querySelector('.trace-source-summary')?.textContent.includes('HAR')
      || document.querySelector('.trace-source-list')?.textContent.includes('HAR 来源')`,
    'HAR source addition',
  );
  await dispatchFile('追加 NetLog 文件', 'synthetic-netlog.json', {
    constants: {
      timeTickOffset: 1_775_260_800_000,
      logEventTypes: { URL_REQUEST_START_JOB: 111 },
      logSourceType: { URL_REQUEST: 1 },
    },
    events: [
      {
        time: '100.01', type: 111, phase: 0,
        source: { id: 1, type: 1 },
        params: { url: 'https://api.example.test/resource-1', method: 'GET' },
      },
      {
        time: '200.01', type: 111, phase: 0,
        source: { id: 2, type: 1 },
        params: { url: 'https://api.example.test/resource-2', method: 'GET' },
      },
      {
        time: '101', type: 111, phase: 0,
        source: { id: 3, type: 1 },
        params: { url: 'https://api.example.test/resource-1', method: 'POST' },
      },
    ],
  });
  await cdp.waitFor(
    `document.querySelector('.trace-source-list')?.textContent.includes('NetLog 来源')`,
    'NetLog source addition',
  );
  await cdp.waitFor(
    `document.querySelector('.trace-evidence-graph')?.textContent.includes('高置信关联')`,
    'high-confidence evidence graph',
  );
  const initial = await cdp.evaluate(`(() => ({
    sourceCount: document.querySelectorAll('.trace-source-list li').length,
    high: document.querySelector('.trace-evidence-graph').textContent.includes('高置信关联'),
    candidate: document.querySelector('.trace-evidence-graph').textContent.includes('候选关联'),
    graphEdges: document.querySelectorAll('[aria-label="等价证据路径"] li').length,
    confidenceCounts: Array.from(
      document.querySelectorAll('[aria-label="等价证据路径"] li')
    ).reduce((counts, item) => {
      const text = item.textContent;
      if (text.includes('高置信')) counts.high += 1;
      else if (text.includes('中置信')) counts.medium += 1;
      else if (text.includes('低置信')) counts.low += 1;
      else counts.unavailable += 1;
      return counts;
    }, { high: 0, medium: 0, low: 0, unavailable: 0 }),
    queryCount: (
      window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples['query-evidence-graph'] || []
    ).length,
    sourceChanges: window.__STAGE3_PRODUCT_BENCHMARK__.sourceChanges,
  }))()`);
  const graphNavigation = await cdp.evaluate(`(async () => {
    const state = window.__STAGE3_PRODUCT_BENCHMARK__;
    const before = (state.protocolSamples['query-evidence-graph'] || []).length;
    const graph = document.querySelector('.trace-evidence-graph');
    const button = graph.querySelector('[aria-label="证据图节点"] button');
    const entityId = button.dataset.evidenceEntityId;
    button.focus();
    button.click();
    while ((state.protocolSamples['query-evidence-graph'] || []).length <= before) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    let selectedButton;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      selectedButton = document.querySelector(
        '.trace-evidence-graph [aria-label="证据图节点"] button[aria-pressed="true"]'
      );
      if (selectedButton) break;
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    const selected = !!selectedButton;
    const beforeRestore = (state.protocolSamples['query-evidence-graph'] || []).length;
    document.querySelector('.trace-evidence-graph').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    while ((state.protocolSamples['query-evidence-graph'] || []).length <= beforeRestore) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    let currentButtons = [];
    let restoredButton;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      currentButtons = Array.from(document.querySelectorAll(
        '.trace-evidence-graph [aria-label="证据图节点"] button'
      ));
      restoredButton = currentButtons.find(
        item => item.dataset.evidenceEntityId === entityId
      );
      if (
        restoredButton
        && !currentButtons.some(item => item.getAttribute('aria-pressed') === 'true')
      ) break;
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return {
      entityId,
      selected,
      restored: !currentButtons.some(item => item.getAttribute('aria-pressed') === 'true'),
      focusRestored: document.activeElement === restoredButton
        || document.activeElement === document.querySelector('.trace-evidence-graph'),
      restoredEntityId: restoredButton?.dataset.evidenceEntityId,
      activeEntityId: document.activeElement?.dataset?.evidenceEntityId,
      activeTagName: document.activeElement?.tagName,
    };
  })()`);
  const sourceChangesBeforeCancellation = await cdp.evaluate(
    'window.__STAGE3_PRODUCT_BENCHMARK__.sourceChanges.length',
  );
  await dispatchFile('追加 HAR 文件', 'replacement.har', {
    log: {
      creator: { name: 'stage4-synthetic-replacement' },
      pages: [],
      entries: [harEntry(1, 100)],
    },
  });
  await cdp.waitFor(
    `!!document.querySelector('[role="alertdialog"]')`,
    'same-kind replacement confirmation',
  );
  const replaceConfirmation = await cdp.evaluate(`(() => {
    const dialog = document.querySelector('[role="alertdialog"]');
    const visible = !!dialog;
    Array.from(dialog.querySelectorAll('button'))
      .find(button => button.textContent.includes('取消替换')).click();
    return visible;
  })()`);
  await cdp.waitFor(
    `!document.querySelector('[role="alertdialog"]')`,
    'replacement cancellation',
  );
  const replacementCancelled = await cdp.evaluate(
    `window.__STAGE3_PRODUCT_BENCHMARK__.sourceChanges.length
      === ${sourceChangesBeforeCancellation}`,
  );
  await dispatchFile('追加 HAR 文件', 'conflicting.har', {
    log: {
      creator: { name: 'stage4-conflicting-alignment' },
      pages: [{
        id: 'navigation-1',
        startedDateTime: '2026-08-02T00:00:00.000Z',
        pageTimings: {},
      }],
      entries: [harEntry(1, 100), harEntry(2, 500)],
    },
  });
  await cdp.waitFor(
    `!!document.querySelector('[role="alertdialog"]')`,
    'conflicting HAR replacement confirmation',
  );
  await cdp.evaluate(`Array.from(
    document.querySelector('[role="alertdialog"]').querySelectorAll('button')
  ).find(button => button.textContent.includes('确认替换')).click()`);
  await cdp.waitFor(
    `document.querySelector('.trace-evidence-graph')?.textContent.includes('时间校准 · 低置信')`,
    'alignment conflict explanation',
  );
  const alignmentConflict = await cdp.evaluate(
    `document.querySelector('.trace-evidence-graph').textContent.includes('时间校准 · 低置信')`,
  );
  await dispatchFile('追加 NetLog 文件', 'uncalibrated-netlog.json', {
    constants: {
      logEventTypes: { URL_REQUEST_START_JOB: 111 },
      logSourceType: { URL_REQUEST: 1 },
    },
    events: [{
      time: '100', type: 111, phase: 0,
      source: { id: 1, type: 1 },
      params: { url: 'https://api.example.test/resource-1', method: 'GET' },
    }],
  });
  await cdp.waitFor(
    `!!document.querySelector('[role="alertdialog"]')`,
    'uncalibrated NetLog replacement confirmation',
  );
  await cdp.evaluate(`Array.from(
    document.querySelector('[role="alertdialog"]').querySelectorAll('button')
  ).find(button => button.textContent.includes('确认替换')).click()`);
  await cdp.waitFor(
    `document.querySelector('.trace-evidence-graph')?.textContent.includes('时间校准 · 不可用')`,
    'unavailable alignment explanation',
  );
  const alignmentUnavailable = await cdp.evaluate(
    `document.querySelector('.trace-evidence-graph').textContent.includes('时间校准 · 不可用')`,
  );
  await cdp.evaluate(`Array.from(document.querySelectorAll('button'))
    .find(button => button.getAttribute('aria-label') === '移除 NetLog 来源').click()`);
  await cdp.waitFor(
    `!document.querySelector('.trace-source-list')?.textContent.includes('NetLog 来源')`,
    'NetLog source removal',
  );
  const afterRemoval = await cdp.evaluate(`(() => ({
    sourceCount: document.querySelectorAll('.trace-source-list li').length,
    graphEdges: document.querySelectorAll('[aria-label="等价证据路径"] li').length,
    sourceChanges: window.__STAGE3_PRODUCT_BENCHMARK__.sourceChanges,
  }))()`);
  const revisions = afterRemoval.sourceChanges.map(item => item.sourceRevision);
  const sourceRevisionObserved = revisions.length >= 5
    && revisions.every((revision, index) => (
      index === 0 || revision === revisions[index - 1] + 1
    ));
  const removal = afterRemoval.sourceChanges.find(item => item.operation === 'removed');
  return {
    addHar: initial.sourceCount >= 2,
    addNetLog: initial.sourceCount === 3,
    replacementConfirmation: replaceConfirmation,
    replacementCancelled,
    replacementConfirmed: afterRemoval.sourceChanges
      .some(item => item.operation === 'replaced'),
    highCandidate: initial.high,
    candidateExplanation: initial.candidate,
    confidenceCounts: initial.confidenceCounts,
    alignmentConflict,
    alignmentUnavailable,
    graphNavigation: initial.queryCount > 0
      && graphNavigation.selected
      && graphNavigation.restored
      && graphNavigation.focusRestored,
    graphNavigationChecks: graphNavigation,
    removeSource: afterRemoval.sourceCount === 2,
    revokedEdgeCount: removal?.revokedEdgeCount
      ?? Math.max(0, initial.graphEdges - afterRemoval.graphEdges),
    revokedFindingCount: removal?.revokedFindingCount ?? 0,
    sourceRevisionObserved,
  };
}

async function waitForHttp() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/`, response => {
          response.resume();
          resolve();
        }).on('error', reject);
      });
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error('Stage 3 static server did not start');
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.socket.on('message', raw => {
      const message = JSON.parse(String(raw));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error.message));
          else pending.resolve(message.result);
        }
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(message.params.exceptionDetails.text);
      }
      if (
        message.method === 'Runtime.consoleAPICalled'
        && message.params.type === 'error'
      ) {
        this.consoleErrors.push(message.params.args
          .map(item => item.value ?? item.description)
          .join(' '));
      }
    });
  }

  open() {
    return new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.text);
    }
    return response.result.value;
  }

  async waitFor(expression, label, attempts = 600) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await this.evaluate(expression)) return;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }
}

async function measureButton(cdp, label, requestType) {
  return cdp.evaluate(`(async()=> {
    const state = window.__STAGE3_PRODUCT_BENCHMARK__;
    const before = (state.protocolSamples[${JSON.stringify(requestType)}] || []).length;
    const button = Array.from(document.querySelectorAll('button'))
      .find(item => item.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (!button) throw new Error('Missing button: ${label}');
    const startedAt = performance.now();
    button.click();
    while ((state.protocolSamples[${JSON.stringify(requestType)}] || []).length <= before) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await new Promise(resolve => requestAnimationFrame(resolve));
    return performance.now() - startedAt;
  })()`);
}

async function measureBrush(cdp, offset) {
  const bounds = await cdp.evaluate(`(() => {
    const bounds = document.querySelector('.trace-timeline-canvas').getBoundingClientRect();
    return { left: bounds.left, top: bounds.top, width: bounds.width };
  })()`);
  const before = await cdp.evaluate(
    `(window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples['query-selection'] || []).length`,
  );
  const startedAt = Date.now();
  const y = bounds.top + 70;
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: bounds.left + bounds.width * (0.55 + offset),
    y,
    button: 'left',
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: bounds.left + bounds.width * (0.65 + offset),
    y,
    button: 'left',
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: bounds.left + bounds.width * (0.65 + offset),
    y,
    button: 'left',
    clickCount: 1,
  });
  await cdp.waitFor(
    `(window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples['query-selection'] || []).length > ${before}`,
    'selection result',
  );
  await cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  return Date.now() - startedAt;
}

async function measureAnalysisTab(cdp, label, requestType) {
  return cdp.evaluate(`(async()=> {
    const state = window.__STAGE3_PRODUCT_BENCHMARK__;
    const before = (state.protocolSamples[${JSON.stringify(requestType)}] || []).length;
    const summary = Array.from(document.querySelectorAll('[role="tab"]'))
      .find(item => item.textContent === '摘要');
    summary?.click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const tab = Array.from(document.querySelectorAll('[role="tab"]'))
      .find(item => item.textContent === ${JSON.stringify(label)});
    if (!tab) throw new Error('Missing analysis tab: ${label}');
    const startedAt = performance.now();
    tab.click();
    while ((state.protocolSamples[${JSON.stringify(requestType)}] || []).length <= before) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await new Promise(resolve => requestAnimationFrame(resolve));
    return performance.now() - startedAt;
  })()`);
}

async function measureSearch(cdp, index) {
  return cdp.evaluate(`(async()=> {
    const state = window.__STAGE3_PRODUCT_BENCHMARK__;
    const before = (state.protocolSamples['query-search'] || []).length;
    const input = document.querySelector('#trace-expert-search');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set;
    setter.call(input, ${JSON.stringify('Layout')} + ${index});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const startedAt = performance.now();
    input.form.requestSubmit();
    while ((state.protocolSamples['query-search'] || []).length <= before) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await new Promise(resolve => requestAnimationFrame(resolve));
    return performance.now() - startedAt;
  })()`);
}

async function runOne(cdp, eventCount, diffHash) {
  cdp.consoleErrors.length = 0;
  await cdp.send('Page.navigate', {
    url: `http://127.0.0.1:${port}/?stage3-product-benchmark=1&event-count=${eventCount}`,
  });
  await cdp.waitFor(
    `window.__STAGE3_PRODUCT_BENCHMARK__?.ready === true
      || !!window.__STAGE3_PRODUCT_BENCHMARK__?.error`,
    `${eventCount} product benchmark`,
  );
  const preparationError = await cdp.evaluate(
    'window.__STAGE3_PRODUCT_BENCHMARK__?.error || null',
  );
  assert(!preparationError, `${eventCount} product benchmark failed: ${preparationError}`);
  if (stage5Mode) {
    await cdp.waitFor(
      `(window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples['query-insights'] || [])
        .length > 0`,
      `${eventCount} initial Insights query`,
    );
  }
  await cdp.evaluate(`(() => {
    window.__stage3ResourceChecks = { created: 0, revoked: 0 };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = value => {
      window.__stage3ResourceChecks.created += 1;
      return create(value);
    };
    URL.revokeObjectURL = value => {
      window.__stage3ResourceChecks.revoked += 1;
      return revoke(value);
    };
  })()`);

  const viewports = {};
  for (const width of [1280, 1100, 900]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(100);
    viewports[String(width)] = await cdp.evaluate(`(() => {
      const visible = selector => getComputedStyle(document.querySelector(selector)).display !== 'none';
      const canvas = visible('.trace-timeline-viewport');
      const insight = visible('.trace-insight-navigator');
      const narrow = visible('.trace-timeline-narrow-list');
      return {
        canvas,
        insight,
        narrow,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        passed: ${width} === 1280
          ? canvas && insight && !narrow
          : ${width} === 1100
            ? canvas && !insight && !narrow
            : !canvas && !insight && narrow,
      };
    })()`);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const zoomSamples = [];
  const panSamples = [];
  for (let index = 0; index < totalRunCount; index += 1) {
    const zoom = await measureButton(cdp, '放大时间轴', 'query-viewport');
    const pan = await measureButton(cdp, '向右平移', 'query-viewport');
    if (index >= warmupCount) {
      zoomSamples.push(zoom);
      panSamples.push(pan);
    }
  }

  for (let index = 0; index < totalRunCount; index += 1) {
    await measureBrush(cdp, (index % 5) * 0.005);
  }
  const measuredViewportQuerySamples = await cdp.evaluate(
    `(window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples['query-viewport'] || [])
      .slice(-${validRunCount})`,
  );
  const measuredSelectionQuerySamples = await cdp.evaluate(
    `(window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples['query-selection'] || [])
      .slice(-${validRunCount})`,
  );
  const flameInteractionSamples = [];
  const callTreeInteractionSamples = [];
  const bottomUpInteractionSamples = [];
  const eventLogInteractionSamples = [];
  const searchInteractionSamples = [];
  for (let index = 0; index < totalRunCount; index += 1) {
    const flame = await measureAnalysisTab(cdp, 'Flame Chart', 'query-flame-chart');
    const callTree = await measureAnalysisTab(cdp, 'Call Tree', 'query-call-tree');
    const bottomUp = await measureAnalysisTab(cdp, 'Bottom-up', 'query-bottom-up');
    const eventLog = await measureAnalysisTab(cdp, 'Event Log', 'query-event-log');
    const search = await measureSearch(cdp, index);
    if (index >= warmupCount) {
      flameInteractionSamples.push(flame);
      callTreeInteractionSamples.push(callTree);
      bottomUpInteractionSamples.push(bottomUp);
      eventLogInteractionSamples.push(eventLog);
      searchInteractionSamples.push(search);
    }
  }
  const analysisProtocolSamples = await cdp.evaluate(`({
    flameChart: (window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples['query-flame-chart'] || []).slice(-${validRunCount}),
    callTree: (window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples['query-call-tree'] || []).slice(-${validRunCount}),
    bottomUp: (window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples['query-bottom-up'] || []).slice(-${validRunCount}),
    eventLog: (window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples['query-event-log'] || []).slice(-${validRunCount}),
    search: (window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples['query-search'] || []).slice(-${validRunCount})
  })`);

  const canvasDrawSamples = [];
  for (let index = 0; index < totalRunCount; index += 1) {
    const elapsed = await cdp.evaluate(`(async()=> {
      const canvas = document.querySelector('.trace-timeline-canvas');
      const startedAt = performance.now();
      canvas.style.width = ${index % 2 === 0 ? "'99.5%'" : "'100%'"};
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return performance.now() - startedAt;
    })()`);
    if (index >= warmupCount) canvasDrawSamples.push(elapsed);
  }

  const canvasBounds = await cdp.evaluate(`(() => {
    const bounds = document.querySelector('.trace-timeline-canvas').getBoundingClientRect();
    return { left: bounds.left, top: bounds.top, width: bounds.width };
  })()`);
  let hoverPoint;
  const laneOffsets = [];
  for (let track = 0; track < 6; track += 1) {
    for (let lane = 0; lane < 3; lane += 1) {
      laneOffsets.push(48 + track * 46 + 12 + lane * 10);
    }
  }
  for (const yOffset of laneOffsets) {
    for (let xOffset = 112; xOffset < canvasBounds.width && !hoverPoint; xOffset += 2) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: canvasBounds.left + xOffset,
        y: canvasBounds.top + yOffset,
      });
      await cdp.evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
      const matched = await cdp.evaluate(
        `document.querySelector('.trace-timeline-selection').textContent.includes('当前悬浮')`,
      );
      if (matched) hoverPoint = {
        x: canvasBounds.left + xOffset,
        y: canvasBounds.top + yOffset,
      };
    }
    if (hoverPoint) break;
  }
  assert(hoverPoint, 'Could not locate a drawn Canvas event for hover verification');
  const hoverSamples = [];
  for (let index = 0; index < totalRunCount; index += 1) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: canvasBounds.left + 20,
      y: canvasBounds.top + 20,
    });
    const startedAt = performance.now();
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: hoverPoint.x,
      y: hoverPoint.y,
    });
    await cdp.evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
    const elapsed = performance.now() - startedAt;
    if (index >= warmupCount) hoverSamples.push(elapsed);
  }
  const hoverVerified = await cdp.evaluate(
    `document.querySelector('.trace-timeline-selection').textContent.includes('当前悬浮')`,
  );

  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: hoverPoint.x,
    y: hoverPoint.y,
    button: 'left',
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: hoverPoint.x,
    y: hoverPoint.y,
    button: 'left',
    clickCount: 1,
  });
  await cdp.waitFor(
    `document.querySelector('#trace-analysis-drawer')?.textContent.includes('事件详情') === true`,
    'Canvas event detail',
  );
  const detailOpenedByCanvas = await cdp.evaluate(
    `document.querySelector('#trace-analysis-drawer')?.textContent.includes('事件详情') === true`,
  );
  assert(detailOpenedByCanvas, 'Canvas click did not open event detail');
  const returnButtonVisible = await cdp.evaluate(
    `!!Array.from(document.querySelectorAll('#trace-analysis-drawer button'))
      .find(button => button.textContent.includes('返回先前视口'))`,
  );
  await cdp.evaluate(`Array.from(document.querySelectorAll('#trace-analysis-drawer button'))
    .find(button => button.textContent.includes('返回先前视口')).click()`);
  await cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const returnNavigation = await cdp.evaluate(`(() => ({
    historyCleared: !Array.from(document.querySelectorAll('#trace-analysis-drawer button'))
      .find(button => button.textContent.includes('返回先前视口')),
    focusReturned: document.activeElement?.classList.contains('trace-timeline-canvas') === true,
  }))()`);
  const equivalentEventText = await cdp.evaluate(`(() => {
    const events = document.querySelectorAll('.trace-timeline-a11y-events button');
    return events.length > 0 && events.length <= 5;
  })()`);

  const themeChecks = await cdp.evaluate(`(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    const light = getComputedStyle(document.querySelector('.trace-timeline-workbench')).backgroundColor;
    document.documentElement.setAttribute('data-theme', 'dark');
    const dark = getComputedStyle(document.querySelector('.trace-timeline-workbench')).backgroundColor;
    return { lightApplied: light.length > 0, darkApplied: dark.length > 0, distinct: light !== dark };
  })()`);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  const reducedMotion = await cdp.evaluate(
    `matchMedia('(prefers-reduced-motion: reduce)').matches`,
  );
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 640,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });
  const zoom200 = await cdp.evaluate(`(() => ({
    narrow: getComputedStyle(document.querySelector('.trace-timeline-narrow-list')).display !== 'none',
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
  }))()`);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await cdp.evaluate(`Array.from(document.querySelectorAll('button'))
    .find(button => button.getAttribute('aria-label') === '展开截图胶片').click()`);
  await cdp.waitFor(
    `!!document.querySelector('.trace-filmstrip-frame img')
      || !!Array.from(document.querySelectorAll('button'))
        .find(button => (button.getAttribute('aria-label') || '').startsWith('加载录制截图'))`,
    'Filmstrip index',
  );
  await cdp.evaluate(`Array.from(document.querySelectorAll('button'))
    .find(button => (button.getAttribute('aria-label') || '').startsWith('加载录制截图'))?.click()`);
  await cdp.waitFor(`!!document.querySelector('.trace-filmstrip-frame img')`, 'Filmstrip frame');
  await cdp.evaluate(`document.querySelector('.trace-filmstrip-frame').click()`);
  await cdp.waitFor(`!!document.querySelector('.trace-filmstrip-dialog')`, 'Filmstrip dialog');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await cdp.waitFor(`!document.querySelector('.trace-filmstrip-dialog')`, 'Filmstrip dialog close');
  const dialogEscape = await cdp.evaluate(`(
    !document.querySelector('.trace-filmstrip-dialog')
    && document.activeElement?.classList.contains('trace-filmstrip-frame') === true
  )`);
  await cdp.evaluate(`document.querySelector('[aria-label="折叠截图胶片并释放内存"]').click()`);

  const expertChecks = {};
  for (const [label, selector, key] of [
    ['Flame Chart', '.trace-flame-chart-canvas', 'flameChart'],
    ['Call Tree', '.trace-analysis-row', 'callTree'],
    ['Bottom-up', '.trace-analysis-row', 'bottomUp'],
    ['Event Log', '.trace-analysis-row', 'eventLog'],
  ]) {
    await cdp.evaluate(`Array.from(document.querySelectorAll('[role="tab"]'))
      .find(tab => tab.textContent === ${JSON.stringify(label)}).click()`);
    await cdp.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`, `${label} render`);
    expertChecks[key] = await cdp.evaluate(
      `!!document.querySelector(${JSON.stringify(selector)})`,
    );
  }
  expertChecks.search = await cdp.evaluate(
    `!!document.querySelector('.trace-search-results')`,
  );
  expertChecks.virtualized = await cdp.evaluate(
    `document.querySelectorAll('.trace-analysis-virtual-list .trace-analysis-row').length <= 80`,
  );
  const detailBeforeDiagnosis = await cdp.evaluate(
    `(window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples['query-event-detail'] || []).length`,
  );
  await cdp.evaluate(`document.querySelector('[aria-label^="定位诊断："]')?.click()`);
  await cdp.waitFor(
    `(window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples['query-event-detail'] || []).length > ${detailBeforeDiagnosis}`,
    'diagnosis navigation',
  );
  expertChecks.diagnosisNavigation = await cdp.evaluate(
    `(window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples['query-event-detail'] || []).length > ${detailBeforeDiagnosis}`,
  );

  for (let index = 0; index < 20; index += 1) {
    await cdp.evaluate(`document.querySelector('[aria-label="放大时间轴"]').click()`);
  }
  await cdp.evaluate(`(() => {
    const canvas = document.querySelector('.trace-timeline-canvas');
    const bounds = canvas.getBoundingClientRect();
    for (let index = 0; index < 20; index += 1) {
      const startX = bounds.left + bounds.width * (0.2 + index * 0.005);
      const endX = startX + 24;
      const y = bounds.top + 70;
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: startX, clientY: y, buttons: 1,
      }));
      canvas.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, clientX: endX, clientY: y,
      }));
    }
  })()`);
  await cdp.waitFor(
    `window.__STAGE3_PRODUCT_BENCHMARK__.queue.selection.cancelledRequestCount > 0
      || window.__STAGE3_PRODUCT_BENCHMARK__.queue.viewport.cancelledRequestCount > 0`,
    'latest-wins cancellation',
  );
  await cdp.waitFor(
    `(window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples['cancel-query'] || []).length > 0`,
    'cancellation response',
  );
  await sleep(250);
  const crossSource = stage4Mode && eventCount === eventCounts[0]
    ? await runCrossSourceChecks(cdp)
    : undefined;
  const stateBeforeClose = await cdp.evaluate('window.__STAGE3_PRODUCT_BENCHMARK__');
  const pageHeapUsedBytes = await cdp.evaluate(
    'performance.memory?.usedJSHeapSize ?? null',
  );
  const componentMounts = await cdp.evaluate(`(() => {
    const state = window.__STAGE3_PRODUCT_BENCHMARK__;
    return {
      TraceTimelineWorkbench: !!document.querySelector('.trace-timeline-workbench'),
      TimelineCanvas: !!document.querySelector('.trace-timeline-canvas'),
      ScreenshotFilmstrip: !!document.querySelector('.trace-filmstrip'),
      TimelineInteractionStore:
        (state.protocolSamples['query-viewport'] || []).length > 0
        && (state.protocolSamples['query-selection'] || []).length > 0,
      FlameChartCanvas: ${JSON.stringify(expertChecks.flameChart)},
      ExpertAnalysisDrawer: !!document.querySelector('.trace-expert-analysis'),
      CallTree: ${JSON.stringify(expertChecks.callTree)},
      BottomUp: ${JSON.stringify(expertChecks.bottomUp)},
      EventLog: ${JSON.stringify(expertChecks.eventLog)},
      Search: ${JSON.stringify(expertChecks.search)},
      Insights: ${JSON.stringify(stage5Mode)}
        ? !!document.querySelector('#trace-insights-heading')
        : false,
      TraceComparison: ${JSON.stringify(stage5Mode)}
        ? !!document.querySelector('.trace-comparison-panel')
        : false,
    };
  })()`);
  await cdp.evaluate(`Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.includes('关闭工作台')).click()`);
  await cdp.waitFor(
    'window.__STAGE3_PRODUCT_BENCHMARK__.sessionClosed === true',
    'session close',
  );
  const resources = await cdp.evaluate(`({
    ...window.__stage3ResourceChecks,
    sessionClosed: window.__STAGE3_PRODUCT_BENCHMARK__.sessionClosed,
    canvasRemoved: !document.querySelector('.trace-timeline-canvas')
  })`);
  const selectionProtocolSamples = stateBeforeClose.protocolSamples['query-selection'] ?? [];
  const cancellationSamples = stateBeforeClose.protocolSamples['cancel-query'] ?? [];
  const artifact = {
    schemaVersion: browserStage,
    status: 'browser-benchmark-verified',
    codeRef: stateBeforeClose.codeRef,
    workingTreeDiffHash: diffHash,
    runner: {
      kind: 'repository-cdp-product-components',
      command,
      playwright: false,
      componentMounts,
    },
    environment: {
      browserUserAgent: await cdp.evaluate('navigator.userAgent'),
      operatingSystem: process.platform,
      cpuLogicalCores: await cdp.evaluate('navigator.hardwareConcurrency || null'),
      deviceMemoryGiB: await cdp.evaluate('navigator.deviceMemory || null'),
      dpr: 1,
    },
    corpus: stateBeforeClose.corpus,
    runs: { warmupCount, validRunCount },
    timings: {
      viewportQuery: timing(measuredViewportQuerySamples),
      selectionQuery: timing(measuredSelectionQuerySamples),
      canvasDraw: timing(canvasDrawSamples),
      zoom: timing(zoomSamples),
      pan: timing(panSamples),
      hover: timing(hoverSamples),
      flameChartQuery: timing(analysisProtocolSamples.flameChart),
      callTreeQuery: timing(analysisProtocolSamples.callTree),
      bottomUpQuery: timing(analysisProtocolSamples.bottomUp),
      eventLogQuery: timing(analysisProtocolSamples.eventLog),
      searchQuery: timing(analysisProtocolSamples.search),
      flameChartInteraction: timing(flameInteractionSamples),
      callTreeInteraction: timing(callTreeInteractionSamples),
      bottomUpInteraction: timing(bottomUpInteractionSamples),
      eventLogInteraction: timing(eventLogInteractionSamples),
      searchInteraction: timing(searchInteractionSamples),
      cancellationResponse: timing(cancellationSamples.slice(-10)),
    },
    interactions: {
      hoverVerified,
      brushSelectionVerified: selectionProtocolSamples.length >= 13,
      detailOpenedByCanvas,
      returnButtonVisible,
      filmstripOpened: resources.created > 0,
      filmstripDialogClosed: dialogEscape,
      ...expertChecks,
      ...(crossSource ? { crossSource } : {}),
    },
    responsive: viewports,
    themes: {
      ...themeChecks,
      zoom200: zoom200.narrow && !zoom200.horizontalOverflow,
      reducedMotion,
    },
    accessibility: {
      equivalentEventText,
      dialogEscape,
      returnNavigation: returnNavigation.historyCleared && returnNavigation.focusReturned,
    },
    transfer: { workerUiBytes: stateBeforeClose.transferBytes },
    truncation: stateBeforeClose.truncation,
    memory: {
      pageHeapUsedBytes,
      workerPeakBytes: null,
      limitation: 'The browser does not expose per-Worker peak memory to page JavaScript',
    },
    queue: stateBeforeClose.queue,
    resources: {
      blobUrlsCreated: resources.created,
      blobUrlsRevoked: resources.revoked,
      sessionClosed: resources.sessionClosed,
      canvasRemoved: resources.canvasRemoved,
    },
    safety: {
      maxJsonBytes: 128 * 1024 * 1024,
      limitRaised: false,
      rawTraceEventsReturnedToUi: false,
    },
    consoleErrors: [...cdp.consoleErrors],
  };
  const suffix = eventCount === 1_000_000 ? '1000k' : `${eventCount / 1_000}k`;
  const baselineStage = stage5Mode ? 'stage4' : 'stage2';
  const baselinePath = path.join(
    reportDir,
    `workbench-${baselineStage}-browser-${suffix}.json`,
  );
  if (fs.existsSync(baselinePath)) {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const comparisons = {
      zoom: [artifact.timings.zoom.p95Ms, baseline.timings.zoom.p95Ms],
      pan: [artifact.timings.pan.p95Ms, baseline.timings.pan.p95Ms],
      hover: [artifact.timings.hover.p95Ms, baseline.timings.hover.p95Ms],
      selection: [
        artifact.timings.selectionQuery.p95Ms,
        baseline.timings.selectionQuery.p95Ms,
      ],
    };
    artifact[`${baselineStage}Regression`] = Object.fromEntries(Object.entries(comparisons)
      .map(([name, [current, previous]]) => [
        name,
        {
          currentP95Ms: current,
          baselineP95Ms: previous,
          regressionRatio: previous === 0 ? 0 : (current - previous) / previous,
        },
      ]));
  }
  return artifact;
}

async function main() {
  buildProductBenchmark();
  buildFlagOffBenchmark();
  assert(fs.existsSync(path.join(buildDir, 'index.html')), `Build directory is missing: ${buildDir}`);
  fs.mkdirSync(reportDir, { recursive: true });
  const diffHash = workingTreeDiffHash();
  const server = childProcess.spawn(
    'python3',
    ['-m', 'http.server', String(port), '--directory', buildDir],
    { cwd: root, stdio: 'ignore' },
  );
  const flagOffServer = stage4Mode
    ? childProcess.spawn(
        'python3',
        ['-m', 'http.server', String(port + 1), '--directory', flagOffBuildDir],
        { cwd: root, stdio: 'ignore' },
      )
    : undefined;
  const profileDir = fs.mkdtempSync('/tmp/netlog-stage3-product-chrome.');
  let chrome;
  try {
    await waitForHttp();
    chrome = childProcess.spawn(chromePath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-first-run',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      `http://127.0.0.1:${port}/`,
    ], { stdio: 'ignore' });
    let targets;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        targets = await getJson('/json');
        break;
      } catch {
        await sleep(100);
      }
    }
    const page = targets?.find(target => target.type === 'page');
    assert(page, 'Chrome page target is unavailable');
    const cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    const artifacts = [];
    for (const eventCount of eventCounts) {
      const artifact = await runOne(cdp, eventCount, diffHash);
      if (stage4Mode && eventCount === eventCounts[0]) {
        const crossSource = artifact.interactions.crossSource;
        for (const key of [
          'addHar', 'addNetLog', 'replacementConfirmation',
          'replacementCancelled', 'replacementConfirmed', 'highCandidate',
          'candidateExplanation', 'alignmentConflict', 'alignmentUnavailable',
          'graphNavigation', 'removeSource', 'sourceRevisionObserved',
        ]) {
          assert(
            crossSource?.[key] === true,
            `Stage 4 check failed: ${key} ${JSON.stringify(
              key === 'graphNavigation'
                ? crossSource?.graphNavigationChecks
                : crossSource?.[key],
            )}`,
          );
        }
      }
      artifacts.push(artifact);
      const suffix = eventCount === 1_000_000 ? '1000k' : `${eventCount / 1_000}k`;
      fs.writeFileSync(
        path.join(reportDir, `workbench-${artifactStage}-browser-${suffix}.json`),
        `${JSON.stringify(artifact, null, 2)}\n`,
      );
      process.stdout.write(`${JSON.stringify({
        eventCount,
        zoomP95: artifact.timings.zoom.p95Ms,
        panP95: artifact.timings.pan.p95Ms,
        hoverP95: artifact.timings.hover.p95Ms,
        selectionP95: artifact.timings.selectionQuery.p95Ms,
      })}\n`);
    }
    let flagOff;
    if (stage4Mode) {
      await cdp.send('Page.navigate', {
        url: `http://127.0.0.1:${port + 1}/?stage3-product-benchmark=1&event-count=100000`,
      });
      await cdp.waitFor(
        `window.__STAGE3_PRODUCT_BENCHMARK__?.ready === true
          || !!window.__STAGE3_PRODUCT_BENCHMARK__?.error`,
        `Stage ${browserStage} flag-off product benchmark`,
      );
      flagOff = stage5Mode
        ? await cdp.evaluate(`(() => ({
            stage5UiAbsent:
              !document.querySelector('#trace-insights-heading')
              && !document.querySelector('.trace-comparison-panel'),
            noStage5Queries: !Object.keys(
              window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples
            ).some(type => [
              'query-insights', 'add-comparison-baseline',
              'remove-comparison-baseline', 'query-trace-comparison'
            ].includes(type)),
            error: window.__STAGE3_PRODUCT_BENCHMARK__.error || null,
          }))()`)
        : await cdp.evaluate(`(() => ({
            crossSourceUiAbsent:
              !document.querySelector('.trace-cross-source-panel')
              && !document.querySelector('.trace-evidence-graph'),
            noCrossSourceQueries: !Object.keys(
              window.__STAGE3_PRODUCT_BENCHMARK__.protocolSamples
            ).some(type => [
              'query-sources', 'query-alignment', 'query-correlation',
              'query-evidence-graph', 'add-source', 'replace-source', 'remove-source'
            ].includes(type)),
            error: window.__STAGE3_PRODUCT_BENCHMARK__.error || null,
          }))()`);
      if (stage5Mode) {
        assert(flagOff.stage5UiAbsent, 'Stage 5 UI appeared with its flag off');
        assert(flagOff.noStage5Queries, 'Stage 5 query ran with its flag off');
      } else {
        assert(flagOff.crossSourceUiAbsent, 'Stage 4 UI appeared with cross-source flag off');
        assert(flagOff.noCrossSourceQueries, 'Cross-source query ran with its flag off');
      }
      assert(!flagOff.error, `Stage ${browserStage} flag-off benchmark failed: ${flagOff.error}`);
    }
    const uiSource = artifacts[0];
    fs.writeFileSync(
      path.join(reportDir, `workbench-${artifactStage}-ui-validation.json`),
      `${JSON.stringify({
        schemaVersion: browserStage,
        status: 'browser-benchmark-verified',
        codeRef: uiSource.codeRef,
        workingTreeDiffHash: diffHash,
        runner: uiSource.runner,
        browserUserAgent: uiSource.environment.browserUserAgent,
        sampleHash: uiSource.corpus.sampleHash,
        viewports: uiSource.responsive,
        interactions: uiSource.interactions,
        accessibility: uiSource.accessibility,
        themes: uiSource.themes,
        resources: uiSource.resources,
        flagOff,
        consoleErrors: uiSource.consoleErrors,
      }, null, 2)}\n`,
    );
    cdp.socket.close();
  } finally {
    chrome?.kill('SIGTERM');
    server.kill('SIGTERM');
    flagOffServer?.kill('SIGTERM');
    await Promise.all([
      waitForExit(chrome),
      waitForExit(server),
      waitForExit(flagOffServer),
    ]);
    fs.rmSync(profileDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
