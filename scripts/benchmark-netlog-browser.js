#!/usr/bin/env node

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const file = argValue('--file');
const label = argValue('--label') || 'manual';
const timeoutMs = Number(argValue('--timeout-ms') || 15 * 60_000);
const mode = argValue('--mode') || (hasFlag('--upload-single-scan') ? 'upload-single-scan' : 'dataset-import');

if (!file) {
  console.error('Usage: npm run benchmark:netlog-browser -- --file /path/to/chrome-net-export-log.json --label real-326mb [--no-launch]');
  process.exit(1);
}

const absoluteFile = path.resolve(file);
if (!fs.existsSync(absoluteFile)) {
  console.error(`File not found: ${absoluteFile}`);
  process.exit(1);
}

const projectRoot = path.join(__dirname, '..');
const buildDir = path.join(projectRoot, 'build');

function runBuildIfNeeded() {
  if (hasFlag('--no-build') && fs.existsSync(path.join(buildDir, 'index.html'))) return;
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function safeStaticPath(urlPath) {
  let decoded = decodeURIComponent(urlPath.split('?')[0]);
  if (decoded.startsWith('/netlog-analyzer-react/')) {
    decoded = decoded.slice('/netlog-analyzer-react'.length);
  }
  const normalized = path.normalize(decoded === '/' ? '/index.html' : decoded);
  const fullPath = path.join(buildDir, normalized);
  return fullPath.startsWith(buildDir) ? fullPath : undefined;
}

runBuildIfNeeded();

const noLaunch = hasFlag('--no-launch');
const chrome = noLaunch ? undefined : findChrome();
if (!noLaunch && !chrome) {
  console.error('Chrome/Chromium not found. Set CHROME_PATH to a Chrome executable and retry.');
  process.exit(1);
}

let server;
let browser;
let finished = false;
let timeoutTimer;

function shutdown(exitCode) {
  if (finished) return;
  finished = true;
  clearTimeout(timeoutTimer);
  if (browser && !browser.killed) browser.kill('SIGTERM');
  if (server) server.close(() => process.exit(exitCode));
  else process.exit(exitCode);
}

server = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end('missing url');
    return;
  }
  if (req.url.startsWith('/__benchmark-file')) {
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': fs.statSync(absoluteFile).size,
      'cache-control': 'no-store',
    });
    fs.createReadStream(absoluteFile).pipe(res);
    return;
  }
  if (req.url.startsWith('/__benchmark-result') && req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.writeHead(204);
      res.end();
      try {
        const parsed = JSON.parse(body);
        console.log(JSON.stringify(parsed, null, 2));
        shutdown(parsed.errors?.length ? 1 : 0);
      } catch (error) {
        console.error('Invalid benchmark result:', error.message);
        console.error(body);
        shutdown(1);
      }
    });
    return;
  }
  const staticPath = safeStaticPath(req.url);
  if (!staticPath || !fs.existsSync(staticPath) || fs.statSync(staticPath).isDirectory()) {
    const indexPath = path.join(buildDir, 'index.html');
    res.writeHead(200, { 'content-type': contentType(indexPath) });
    fs.createReadStream(indexPath).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': contentType(staticPath), 'cache-control': 'no-store' });
  fs.createReadStream(staticPath).pipe(res);
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}/?netlogBrowserBenchmark=1&label=${encodeURIComponent(label)}&fileName=${encodeURIComponent(path.basename(absoluteFile))}&timeoutMs=${timeoutMs}&mode=${encodeURIComponent(mode)}`;
  if (noLaunch) {
    console.error(`Open this URL in a Chromium browser to run the benchmark:\n${url}`);
    timeoutTimer = setTimeout(() => {
      console.error(`Benchmark timeout after ${timeoutMs}ms`);
      shutdown(1);
    }, timeoutMs + 30_000);
    return;
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netlog-browser-benchmark-'));
  const crashDumpsDir = path.join(userDataDir, 'crash-dumps');
  fs.mkdirSync(crashDumpsDir, { recursive: true });
  browser = spawn(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-crash-reporter',
    '--disable-crashpad',
    '--disable-breakpad',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-sync',
    '--disable-features=OptimizationHints,AutofillServerCommunication,CertificateTransparencyComponentUpdater',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    `--crash-dumps-dir=${crashDumpsDir}`,
    `--user-data-dir=${userDataDir}`,
    url,
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME: userDataDir,
      TMPDIR: userDataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  browser.stdout.on('data', chunk => process.stderr.write(chunk));
  browser.stderr.on('data', chunk => process.stderr.write(chunk));
  browser.on('exit', code => {
    if (!finished) {
      console.error(`Chrome exited before benchmark result. code=${code}; url=${url}`);
      console.error(`If needed, open manually: ${url}`);
      console.error(`Local file URL for reference: ${pathToFileURL(absoluteFile).href}`);
      shutdown(1);
    }
  });
  timeoutTimer = setTimeout(() => {
    console.error(`Benchmark timeout after ${timeoutMs}ms`);
    shutdown(1);
  }, timeoutMs + 30_000);
});

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
