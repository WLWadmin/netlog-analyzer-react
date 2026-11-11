// Offline deliverable verification only. Does not load URLs or launch a browser.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require(path.resolve(__dirname, '../../../node_modules/jsdom'));
const review = path.resolve(__dirname, '..');
const prototype = path.resolve(review, 'prototype');
let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
function load(root, filename, script) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, filename), 'utf8'), { runScripts: 'outside-only' });
  dom.window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  return dom;
}
const matrix = load(review, 'feature-matrix.html', 'assets/report.js');
const d = matrix.window.document;
const visible = () => [...d.querySelectorAll('tbody tr')].filter(r => !r.hidden);
const change = (id, value, event = 'change') => {
  d.getElementById(id).value = value;
  d.getElementById(id).dispatchEvent(new matrix.window.Event(event));
};
check(visible().length === 311, '311 initial rows');
for (const kind of ['user-facing', 'expert-facing', 'internal-capability', 'experimental', 'compatibility-contract']) {
  change('matrix-kind', kind);
  check(visible().length > 0 && visible().every(r => r.dataset.kind === kind), kind);
}
change('matrix-category', 'Trace');
change('matrix-kind', 'experimental');
check(visible().length > 0 && visible().every(r => r.dataset.category === 'Trace'), 'combined category/class filter');
change('matrix-search', 'NOT_A_FEATURE_ID', 'input');
check(visible().length === 0 && !d.getElementById('matrix-empty').hidden, 'empty result');
d.getElementById('matrix-reset').click();
check(visible().length === 311 && d.activeElement.id === 'matrix-search', 'reset and focus');
change('matrix-sort', 'name');
check(d.querySelectorAll('tbody tr').length === 311, 'sort keeps all protection rows');
d.querySelector('.theme-toggle').click();
check(d.documentElement.dataset.theme === 'dark', 'matrix theme');
matrix.window.close();

const demo = load(prototype, 'index.html', 'assets/prototype.js');
const p = demo.window.document;
const click = selector => { const b = p.querySelector(selector); assert(b, selector); b.click(); };
const selectSource = source => {
  p.getElementById('source').value = source;
  p.getElementById('source').dispatchEvent(new demo.window.Event('change', { bubbles: true }));
};
const invalidAction = action => {
  const button = p.createElement('button');
  button.dataset[action] = '999999'; p.body.appendChild(button); button.click(); button.remove();
};
click('[data-page="requests"]');
click('[data-select="103"]');
const prior = p.getElementById('workspace').innerHTML;
for (const action of ['jump', 'raw', 'select']) {
  invalidAction(action);
  check(p.getElementById('overlay-root').textContent.includes('目标请求不存在'), 'missing ' + action);
  check(p.getElementById('workspace').innerHTML === prior, 'missing target preserves workspace ' + action);
  click('#close-overlay');
}
check(p.querySelector('.detail').textContent.includes('REQUEST 103'), 'missing ID never selects first request');
const netRows = [...p.querySelectorAll('.detail .timing-row')];
const intervals = netRows.map(r => [+r.dataset.start, +r.dataset.end]);
check(intervals[0][0] < intervals[1][0] && intervals[0][1] > intervals[1][0], 'NetLog overlap at actual positions');
check(p.querySelector('.detail .bar.unknown') !== null, 'NetLog unknown interval');
function geometry(rows) {
  rows.forEach(row => {
    const start = +row.dataset.start, end = +row.dataset.end;
    const origin = +row.dataset.origin, total = +row.dataset.total;
    const bar = row.querySelector('.bar');
    check(Math.abs(parseFloat(bar.style.left) - (start-origin)/total*100) < 1e-6, 'start position');
    check(Math.abs(parseFloat(bar.style.width) - (end-start)/total*100) < 1e-6, 'interval width');
    check(start >= origin && end <= origin+total && end >= start, 'interval bounds');
  });
}
geometry(netRows);
selectSource('har'); click('[data-page="requests"]'); click('[data-select="103"]');
const harRows = [...p.querySelectorAll('.detail .timing-row')];
geometry(harRows);
check(harRows.length === 4 && +harRows[3].dataset.end === 4800 && +harRows[2].dataset.start === 200, 'HAR known intervals');
selectSource('trace');
geometry([...p.querySelectorAll('.timing-row')]);
check(p.querySelector('.bar.unknown') !== null && p.getElementById('workspace').textContent.includes('1200–1600ms'), 'Trace clock and unknown');
selectSource('combined');
invalidAction('jump');
check(p.getElementById('source').value === 'combined', 'missing cross-source jump preserves source');
click('#close-overlay');
for (const source of ['netlog', 'har', 'trace', 'combined', 'ab', 'go']) {
  selectSource(source);
  check(p.getElementById('workspace').textContent.includes('不是完整生产功能清单'), 'historical coverage notice ' + source);
  check(p.querySelector('a[href="../feature-matrix.html"]') !== null, 'matrix mapping link ' + source);
}
demo.window.close();
console.log(JSON.stringify({ status: 'passed', checks, method: 'offline-jsdom', browser: 'not-run', network: 'not-used' }));
