# REVIEW-C 复现与验收设计

以下区分现有生产行为的复现、拟议 schema 样例验证和未来生产实现验收。方案/样例通过不能等同新 builder 通过；不修改现有测试以放行已拒绝契约。

## 本轮实际证据

| 检查 | 状态 | 实际结果 |
|---|---|---|
| 当前 parser ID、两次解析碰撞、分享重编号/缺失 Body、专家字段对照、拟议 schema 样例/反例 | passed（证据检查）；3 项 expected RED | 隔离 Node 探针 35 项检查通过，捕获三项预期断言失败。失败不会被输出为整改 GREEN |
| 全量 Jest，生产源码仍为 e76030e | passed | 208 套、1752 项，4 套/12 项既有 skip，35.716s |
| npm run lint / npm run typecheck | passed | 当前未改生产基线通过 |
| REACT_APP_ENABLE_TRACE_ANALYSIS=1 npm run build | passed | 当前基线构建成功；不等于拟议 DTO 已实现 |
| 已审核 HEAD GitHub CI | passed | e76030e 的 PR Checks / Test and build，run 42985138525 已 SUCCESS |
| 新 DTO 生产 RED/GREEN、机器消费者迁移验收 | not-run | 等待 D-C-V1/D-C-META 批准；当前只有契约及示例 |
| 容器空值精确检测 | blocked | 不查看内部无法确定 `{}`/`[]` 空/非空；推荐 uninspected 待批准 |
| 真实样本、500/800MB、Excel/系统下载 | not-run | 不使用合成探针或 schema 校验替代 |

上述记录对应本轮验证时的源码；最终文档提交若触发新 CI，需按新 HEAD 再读实际状态。没有新增依赖，schema 样例验证使用现有 transitive Ajv 6.15.0；不将 Ajv 新接入生产。

最终文档内命令已提取并以 Asia/Shanghai 重跑，结果仍为 35 passed + 3 expected RED；16 处本地文档链接、3 个拟议 JSON 文件解析及限定公开文件模式检查通过。`git diff --check` 通过，本轮仅 6 个 reviews/p0-a 评审文件，无 src/scripts/依赖/配置变更。限定模式检查不等于独立秘密扫描。

## 获批后需成立的回归

| ID | 输入/操作 | 必须断言 |
|---|---|---|
| C-ID-01 | 真实 parser 解析两条，先导出全量，再只选第二条 | 分享/专家第二条均为原 entry-2；当前分享 entry-1 必须 RED |
| C-ID-02 | 同一分析两次反向排序、过滤、不同可见分页 | 以原 ID 对齐同一记录；导出全筛选条目，不按预览分页截断 |
| C-ID-03 | 两个独立 parseLogFile 调用 | 均可 entry-1，不能通过“唯一 ID”断言；接收端 namespace+id 区分 |
| C-STATE-01 | own 属性 absent/undefined/null/""/非空字符串/0/false | 对应 examples 中状态；不把 0/false 当 missing；不输出原值 |
| C-STATE-02 | `{}`、非空对象、`[]`、非空数组 | 类型区分，emptiness 都 uninspected；此测试不证明空容器检测 |
| C-STATE-03 | Go Headers/Body/BodyRaw 与代理字段 getter 抛错 | 分享不执行 getter，状态 uninspected；专家行为按原路径，不改原字段 |
| C-STATE-04 | 内容对象的 getter/toJSON 抛错 | 分享状态检测不访问内部，不调用序列化；元数据无原键/值/长度/hash |
| C-STATE-05 | own descriptor 不可取得/继承属性/整个 proxyInfo null 或缺失 | 不猜 missing 或制造代理容器；异常状态 uninspected，null/missing 父级保留 |
| C-STATE-06 | body/bodyRaw 分别设置不同状态 | 两者各自检测，不从 body 推导 bodyRaw 存在，也不读取 rawLine 猜测 |
| C-SCHEMA-01 | 分享 v1 正常导出 | 按 kind 校验完整 envelope、严格字段及版本；实际 builder 输出须验证 |
| C-SCHEMA-02 | 旧布局、未知 version/profile/kind、注入原字段和 metadata.value | 被拒绝，不能静默回退 |
| C-LEGACY-01 | NetLog 各开放字段所有 JSON 类型和 null/missing、全部请求 Timing/零值/负码 | 专家无新 envelope/metadata；原 DTO keys/值/optional 精确对照旧出口 |
| C-LEGACY-02 | Go Body 类型矩阵、缺失/undefined bodyRaw、原 Headers/id/rawLine | 专家精确对照旧 DTO 的 JSON.stringify 结果；分享不得污染本地输入 |
| C-UI-01 | App/Go JSON 默认分享 → 勾选专家 → 复制/下载 → 重开 | profile/旧结构准确；同快照、完整内容、专家原字段，保留 B 预览预算 |

下面的命令可直接在仓库根执行，复验本轮关键事实和 schema 示例。它只读当前实现与 JSON fixtures，不包含拟议分享 builder；三个 expected RED 是捕获的真实不满足要求，脚本成功退出仅表示按预期复现。完整状态识别、getter 防读取及新 DTO 输出还需获批后实现上述回归。

```sh
TZ=Asia/Shanghai node <<'NODE'
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const assert = require('assert');
const taskRequire = createRequire(path.join(process.cwd(), 'package.json'));
const ts = taskRequire('typescript');
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    module._compile(outputText, filename);
  };
}
const { parseLogFile } = taskRequire('./src/logParser');
const { buildLogEntriesJson } = taskRequire('./src/components/log/exportLogEntries');
const { buildNetlogJsonExport } = taskRequire('./src/utils/netlogExport');
const { parseLog } = taskRequire('./src/parsers/netlog/parser');
const Ajv = taskRequire('ajv');
const prefix = 'reviews/p0-a/';
const schema = JSON.parse(fs.readFileSync(prefix + 'review-c-sharing-v1.schema.json', 'utf8'));
const examples = JSON.parse(fs.readFileSync(prefix + 'review-c-examples.json', 'utf8'));
const ajv = new Ajv({ allErrors: true, strictKeywords: true });
const validate = ajv.compile(schema);
let passed = 0;
function check(name, run) {
  run();
  passed += 1;
  console.log('passed: ' + name);
}
check('proposed NetLog schema example', () => assert.strictEqual(validate(examples.proposedNetlog), true));
check('proposed Go schema example', () => assert.strictEqual(validate(examples.proposedGo), true));
const validateState = ajv.compile({ $ref: schema.$id + '#/definitions/fieldState' });
for (const item of examples.bodyStateCases) {
  check('proposed field-state schema: ' + item.case, () => assert.strictEqual(validateState(item.expected), true));
}
for (const [label, mutate] of [
  ['unsupported version', value => { value.version = 2; }],
  ['wrong profile', value => { value.profile = 'expert'; }],
  ['raw headers injected', value => { value.data.entries[0].headers = {}; }],
  ['raw body injected', value => { value.data.entries[0].body = null; }],
  ['placeholder body injected', value => { value.data.entries[0].body = '[expert only]'; }],
  ['metadata value injected', value => { value.data.entries[0].redactions.body.value = 'SYNTHETIC_PRIVATE'; }],
  ['container empty claimed', value => { value.data.entries[0].redactions.headers.emptiness = 'empty'; }],
]) {
  check('schema rejects ' + label, () => {
    const invalid = JSON.parse(JSON.stringify(examples.proposedGo));
    mutate(invalid);
    assert.strictEqual(validate(invalid), false);
  });
}
const lines = [
  '[w1] Info 2026-11-11 00:00:00 Got Success 200 GET:https://example.test/a | +0ms',
  '[w1] Info 2026-11-11 00:00:01 Got Success 200 GET:https://example.test/b | body -> | +0ms',
];
const entries = parseLogFile(lines.join('\n')).entries;
check('parser generates stable IDs before selection', () => assert.deepStrictEqual(entries.map(e => e.id), ['entry-1', 'entry-2']));
check('independent parses can collide', () => {
  const other = parseLogFile(lines[0]).entries;
  assert.strictEqual(other[0].id, entries[0].id);
});
const currentShare = JSON.parse(buildLogEntriesJson([entries[1]])).entries[0];
const expert = JSON.parse(buildLogEntriesJson([entries[1]], true)).entries[0];
check('current Go comparison matches actual output', () => {
  const fields = ['id', 'headers', 'body', 'bodyRaw'];
  assert.deepStrictEqual(Object.fromEntries(fields.map(key => [key, currentShare[key]])), examples.goComparison.currentShareFragment);
  assert.deepStrictEqual(Object.fromEntries(fields.filter(key => Object.hasOwn(expert, key)).map(key => [key, expert[key]])), examples.goComparison.expertFragment);
});
check('expert ID stays stable across filtering and reversal', () => {
  const full = JSON.parse(buildLogEntriesJson(entries, true)).entries;
  const reversed = JSON.parse(buildLogEntriesJson([...entries].reverse(), true)).entries;
  assert.strictEqual(expert.id, entries[1].id);
  assert.deepStrictEqual(reversed.map(e => e.id), full.map(e => e.id).reverse());
});
let expectedFailures = 0;
for (const [name, assertion] of [
  ['current sharing ID stable on filtering', () => assert.strictEqual(currentShare.id, entries[1].id)],
  ['current sharing omits absent body', () => assert.strictEqual(Object.hasOwn(currentShare, 'body'), false)],
  ['current sharing schema declares version/profile', () => assert.strictEqual(validate(JSON.parse(buildLogEntriesJson(entries))), true)],
]) {
  try { assertion(); throw new Error('regression did not reproduce'); }
  catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    expectedFailures += 1;
    console.log('expected RED: ' + name);
  }
}
for (const value of [undefined, null, '', 0, false, {}, [], { private: 'SYNTHETIC_PRIVATE' }, ['SYNTHETIC_PRIVATE']]) {
  const entry = { ...entries[0], body: value, bodyRaw: undefined };
  check('expert Go retains body type and optional behavior ' + String(passed), () => {
    assert.deepStrictEqual(JSON.parse(buildLogEntriesJson([entry], true)).entries[0], JSON.parse(JSON.stringify(entry)));
  });
}
const netlog = parseLog({ events: [{ time: '0', type: 1, phase: 0, source: { id: 1, type: 1 }, params: {} }] }).result;
netlog.proxyInfo.proxySettings = null;
delete netlog.proxyInfo.effectiveProxy;
netlog.proxyInfo.originalProxy = { private: 'SYNTHETIC_PRIVATE' };
check('current NetLog comparison matches actual output', () => {
  const safe = JSON.parse(buildNetlogJsonExport(netlog)).proxyInfo;
  const local = JSON.parse(buildNetlogJsonExport(netlog, true)).proxyInfo;
  const fields = ['proxySettings', 'effectiveProxy', 'originalProxy'];
  assert.deepStrictEqual(Object.fromEntries(fields.map(key => [key, safe[key]])), examples.netlogComparison.currentShareFragment);
  assert.deepStrictEqual(Object.fromEntries(fields.filter(key => Object.hasOwn(local, key)).map(key => [key, local[key]])), examples.netlogComparison.expertFragment);
});
console.log(JSON.stringify({ passed, expectedFailures, scope: 'reviewed production and proposed JSON fixtures only; no new sharing implementation' }));
NODE
```

本轮使用上述相同脚本在仓库根执行；中间探针和原始输出置于临时目录，不作为新增产品脚本提交。生产全量命令如下：

```sh
CI=true npm test -- --watchAll=false --runInBand
npm run lint
npm run typecheck
REACT_APP_ENABLE_TRACE_ANALYSIS=1 npm run build
git diff --check
```
