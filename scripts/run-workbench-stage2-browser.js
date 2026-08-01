#!/usr/bin/env node

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..');
const buildDir = path.resolve(process.env.WORKBENCH_STAGE2_BUILD_DIR
  ?? '/tmp/netlog-workbench-stage2-product-build');
const reportDir = path.resolve(process.env.WORKBENCH_STAGE2_REPORT_DIR
  ?? path.join(root, 'docs/superpowers/reports'));
const port = Number(process.env.WORKBENCH_STAGE2_PORT ?? 4182);
const chromePath = process.env.CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const eventCounts = [100_000, 500_000, 1_000_000];
const command = 'node scripts/run-workbench-stage2-browser.js';
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
      REACT_APP_WORKBENCH_BENCHMARK_REF: `${head}+stage2-working-tree`,
    },
    stdio: 'inherit',
  });
}

function getJson(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1',
      port: 9224,
      path: urlPath,
    }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
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
  throw new Error('Stage 2 static server did not start');
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
    const state = window.__STAGE2_PRODUCT_BENCHMARK__;
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
    `(window.__STAGE2_PRODUCT_BENCHMARK__.protocolSamples['query-selection'] || []).length`,
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
    `(window.__STAGE2_PRODUCT_BENCHMARK__.protocolSamples['query-selection'] || []).length > ${before}`,
    'selection result',
  );
  await cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  return Date.now() - startedAt;
}

async function runOne(cdp, eventCount, diffHash) {
  cdp.consoleErrors.length = 0;
  await cdp.send('Page.navigate', {
    url: `http://127.0.0.1:${port}/?stage2-product-benchmark=1&event-count=${eventCount}`,
  });
  await cdp.waitFor(
    `window.__STAGE2_PRODUCT_BENCHMARK__?.ready === true
      || !!window.__STAGE2_PRODUCT_BENCHMARK__?.error`,
    `${eventCount} product benchmark`,
  );
  const preparationError = await cdp.evaluate(
    'window.__STAGE2_PRODUCT_BENCHMARK__?.error || null',
  );
  assert(!preparationError, `${eventCount} product benchmark failed: ${preparationError}`);
  await cdp.evaluate(`(() => {
    window.__stage2ResourceChecks = { created: 0, revoked: 0 };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = value => {
      window.__stage2ResourceChecks.created += 1;
      return create(value);
    };
    URL.revokeObjectURL = value => {
      window.__stage2ResourceChecks.revoked += 1;
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
    `(window.__STAGE2_PRODUCT_BENCHMARK__.protocolSamples['query-viewport'] || [])
      .slice(-${validRunCount})`,
  );
  const measuredSelectionQuerySamples = await cdp.evaluate(
    `(window.__STAGE2_PRODUCT_BENCHMARK__.protocolSamples['query-selection'] || [])
      .slice(-${validRunCount})`,
  );

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
  const detailOpenedByCanvas = true;
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
    `window.__STAGE2_PRODUCT_BENCHMARK__.queue.selection.cancelledRequestCount > 0
      || window.__STAGE2_PRODUCT_BENCHMARK__.queue.viewport.cancelledRequestCount > 0`,
    'latest-wins cancellation',
  );
  await cdp.waitFor(
    `(window.__STAGE2_PRODUCT_BENCHMARK__.protocolSamples['cancel-query'] || []).length > 0`,
    'cancellation response',
  );
  await sleep(250);
  const stateBeforeClose = await cdp.evaluate('window.__STAGE2_PRODUCT_BENCHMARK__');
  await cdp.evaluate(`Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.includes('关闭工作台')).click()`);
  await cdp.waitFor(
    'window.__STAGE2_PRODUCT_BENCHMARK__.sessionClosed === true',
    'session close',
  );
  const resources = await cdp.evaluate(`({
    ...window.__stage2ResourceChecks,
    sessionClosed: window.__STAGE2_PRODUCT_BENCHMARK__.sessionClosed,
    canvasRemoved: !document.querySelector('.trace-timeline-canvas')
  })`);
  const selectionProtocolSamples = stateBeforeClose.protocolSamples['query-selection'] ?? [];
  const cancellationSamples = stateBeforeClose.protocolSamples['cancel-query'] ?? [];
  const artifact = {
    schemaVersion: 2,
    status: 'browser-benchmark-verified',
    codeRef: stateBeforeClose.codeRef,
    workingTreeDiffHash: diffHash,
    runner: {
      kind: 'repository-cdp-product-components',
      command,
      playwright: false,
      componentMounts: {
        TraceTimelineWorkbench: true,
        TimelineCanvas: true,
        ScreenshotFilmstrip: true,
        TimelineInteractionStore: true,
      },
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
      cancellationResponse: timing(cancellationSamples.slice(-10)),
    },
    interactions: {
      hoverVerified,
      brushSelectionVerified: selectionProtocolSamples.length >= 13,
      detailOpenedByCanvas,
      returnButtonVisible,
      filmstripOpened: resources.created > 0,
      filmstripDialogClosed: dialogEscape,
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
    memory: {
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
  return artifact;
}

async function main() {
  buildProductBenchmark();
  assert(fs.existsSync(path.join(buildDir, 'index.html')), `Build directory is missing: ${buildDir}`);
  fs.mkdirSync(reportDir, { recursive: true });
  const diffHash = workingTreeDiffHash();
  const server = childProcess.spawn(
    'python3',
    ['-m', 'http.server', String(port), '--directory', buildDir],
    { cwd: root, stdio: 'ignore' },
  );
  const profileDir = fs.mkdtempSync('/tmp/netlog-stage2-product-chrome.');
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
      '--remote-debugging-port=9224',
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
      artifacts.push(artifact);
      const suffix = eventCount === 1_000_000 ? '1000k' : `${eventCount / 1_000}k`;
      fs.writeFileSync(
        path.join(reportDir, `workbench-stage2-browser-${suffix}.json`),
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
    const uiSource = artifacts[0];
    fs.writeFileSync(
      path.join(reportDir, 'workbench-stage2-ui-validation.json'),
      `${JSON.stringify({
        schemaVersion: 2,
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
        consoleErrors: uiSource.consoleErrors,
      }, null, 2)}\n`,
    );
    cdp.socket.close();
  } finally {
    chrome?.kill('SIGTERM');
    server.kill('SIGTERM');
    await Promise.all([waitForExit(chrome), waitForExit(server)]);
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
