## Why

<!-- 用户问题、影响、目标和范围。仅写已有证据。 -->

## What Changed

<!-- 描述最终行为、关键实现与必要非目标，不记录对话过程。 -->

## Testing

<!-- 只填写本次实际执行的命令和结果；不要预填 PASS。 -->

| Command | Status | Candidate HEAD / diff | Limitations |
| --- | --- | --- | --- |
| `<targeted test or NOT_RUN>` | `NOT_RUN` | `<sha or working tree>` | `<reason or gap>` |
| `<full test, if applicable>` | `NOT_RUN` | `<sha or working tree>` | `<reason or gap>` |
| `<build, if applicable>` | `NOT_RUN` | `<sha or working tree>` | `<reason or gap>` |
| `<static checks, if applicable>` | `NOT_RUN` | `<sha or working tree>` | `<reason or gap>` |

按改动范围选择相关检查：targeted/full test、build、静态检查，以及 README 中适用的共享诊断门禁、Trace 门禁和真实样本/人工复核。不要把全部基准测试作为每个 PR 的必跑项。

<!-- 说明未运行或不适用的检查，不要用“看起来应该通过”替代实际结果。 -->

### 证据说明

- 候选版本：`<commit SHA 或工作区状态>`
- 变更路径：`<production / test / docs / config>`
- 真实样本或人工验证：`NOT_RUN` / `PASS` / `FAIL` / `NOT_AVAILABLE`
- 如适用，记录样本类别，但不得暴露凭据、Cookie、标识符或完整查询参数。

## Risks / Compatibility

<!-- 说明解析契约、来源映射、Worker 生命周期、诊断证据边界、外发与敏感数据、feature flag、桌面入口和部署缺口、回退方式。 -->

- 解析契约或 status/error 字段兼容性：`<无或说明>`
- source/request/body 映射及字节偏移兼容性：`<无或说明>`
- Worker 生命周期、session/reset 和大文件行为：`<无或说明>`
- 诊断证据、置信度、隐私和外部网络行为：`<无或说明>`
- feature flag、桌面浏览器入口、部署和回退：`<无或说明>`

- [ ] 已核对格式解析、失败字段和来源/body 映射边界。
- [ ] 已核对诊断结论的证据、置信度、隐私和外发边界。
- [ ] 已核对 Worker/React 生命周期、大文件路径及相关兼容性。

<!-- 若入口、部署或真实数据尚未对账，请明确写出缺口；源码/build/页面可打开不等于目标入口已更新。 -->

<!-- Screenshots：仅在有真实截图时补充。 -->
<!-- Related Issue：仅在有真实关联 Issue 时补充，不虚构或使用自动关闭关键字。 -->

本地模板不配置 GitHub required checks，也不授权远程规则、权限、Review、Merge 或部署操作。
