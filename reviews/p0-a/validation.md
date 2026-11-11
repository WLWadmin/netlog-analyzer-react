# P0-A 验证记录

本记录针对当前 P0-A 补丁。提交身份通过承载本文件的 Git commit/PR HEAD 确认；不把设计报告历史测试当成本轮执行结果。

## 修改前失败复现

仅新增回归测试后，在旧生产实现上实际执行：

```sh
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/App.phase3.test.tsx --testNamePattern '默认 JSON|CSV 保留'
```

实际结果：**failed，2 项失败**。JSON 默认下载含合成 URL 凭据值；CSV 含引号/换行文本未正确编码，`0` 被旧 `|| ''` 转为空。测试只断言泄漏类别/布尔值，不打印泄漏原文；全部 fixture 为合成数据。

修改后的对应测试位于同一文件，另增加专家字段、取消、新预览默认值与 reset 验证。新增 NetLog、Go、Trace、摘要和共享预览测试覆盖数值/缺失、别名一致/碰撞、正文不读取、冻结输入、原专家字段及预览/复制/下载快照。

## 执行历史

| 检查 | 状态 | 实际结果/含义 |
|---|---|---|
| 首轮出口修复及既有 masking 定向测试 | passed | 2 套，31 项通过 |
| 初次新增测试 | failed | 测试 fixture 空 events 被 parser 正确拒绝；jest-dom matcher 未显式加载；Trace Ant Design 子包被旧 Jest resolver 阻塞。已修正 fixture、导入和 UI mock，未削弱原断言 |
| 首次全量回归 | failed | 207 套/1692 项通过，1 套 Trace facts 在加载阶段失败，4 套/12 项既有 skip；为 facts 套补齐 UI mock |
| 初次 Trace flag 构建 | passed | CRA 类型/ESLint 构建成功；不是浏览器视觉验收 |
| 后续定向检查 | failed | 新交接测试使用不支持的 jest-dom 非对称 matcher；已改为读取实际 textarea 值并保留相同包含/排除断言 |

## 最终候选检查

冻结最终源码后已重新执行下面命令（仅随后更新本验证文档和 PR 描述）：

```sh
CI=true npm test -- --watchAll=false --runInBand
REACT_APP_ENABLE_TRACE_ANALYSIS=1 npm run build
npm run typecheck
npm run lint
git diff --check
```

| 最终检查 | 状态 | 证据 |
|---|---|---|
| 全量回归 | passed | 208 套、1698 项通过；4 套/12 项既有 skip；耗时 40.432s，无新增 skip |
| Trace flag 构建/类型/ESLint | passed | CRA optimized production build 成功，main gzip 332.14 kB；仅 Node fs.F_OK deprecation 提示 |
| 独立 typecheck/lint | passed | `tsc --noEmit` 和全项目 ESLint 零 warning 成功 |
| diff 边界 | passed | `git diff --check` 成功；未改 package/lockfile、Worker、上传、导航、规则或 Flags |
| 公开提交候选安全扫描 | passed | 27 个候选文件，凭据/私钥/真实工作区路径/协作署名模式命中 0；仅代表实际模式检查，不是完整秘密检测器 |
| 作者安全复核 | passed | 沿入口 → 既有 masking/白名单 → 预览/复制/下载检查本次差异；未发现新引入的可复现泄漏/注入路径；不代替独立审查 |
| 暂存边界 | passed | 显式暂存 27 个候选文件，`git diff --cached --check` 成功；清单不含 docs、构建、依赖、真实日志或临时缓存 |
| 合成导出安全/格式/输入不变测试 | passed | 纳入本次 1698 项；App/Go/Trace/摘要/HAR/预览的新回归及既有兼容测试通过 |
| 脱敏真实样本与人工导出差异复核 | not-run | 未提供适用真实样本；不访问用户浏览器数据 |
| 500/800MB 同设备性能及完整浏览器导出 | not-run | 不以 compact DTO/getter fixture 或已有性能门禁代替实测 |
| Edge 视觉与系统下载/Excel CSV 打开验收 | blocked | 尚无已确认避开钥匙串的自动化路径；未启动或切换其他浏览器 |
| 外部独立安全复验 | not-run | 本轮仅作者安全复核与合成测试 |
| GitHub PR CI | not-run | Draft PR 创建后读取实际状态；不能以本地 passed 代替 |

原有测试 skip 保留，不能把 skip 写为通过。全量测试包含共享诊断门禁与 Trace 门禁；不修改规则/阈值、黄金基线或发布门槛。

冻结的 25 个变更源码/测试文件摘要：`034adfee72446b56243e564ce154b631ee077c9a41152dd0acbfd36a717b8da2`。算法：对每个文件计算 SHA-256，构造 `relative-path:hex-digest`，按路径排序并用 LF 连接，再计算 SHA-256；不含评审 Markdown。对应文件清单见 README 与本提交 diff。
