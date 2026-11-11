# 待负责人确认的决策与阻塞

设计收口不自动授权P0。D01–D07均维持PENDING_APPROVAL；技术顾问推荐各表方案A，只是推荐。已接受总体原则不需要重议，本清单仅记录正式审批状态与工程前置。

| 项目 | 当前状态 | 所需负责人确认 |
|---|---|---|
| D01 | PENDING_APPROVAL | C1生产交互方案A及后续批准范围；本轮仅修历史原型 |
| D02 | PENDING_APPROVAL | 高风险命题增量迁移A，保留未迁移可证实观察 |
| D03 | PENDING_APPROVAL | 自身生命周期/未闭合下界A；旧观察窗口保留 |
| D04 | PENDING_APPROVAL | 安全分享/显式专家保留配置A，逐字段验证本地与导出能力边界 |
| D05 | PENDING_APPROVAL | 不新增会话持久化A，既有记录/轻量存储保留 |
| D06 | PENDING_APPROVAL | 先真实基线再定预算A，不以截断满足预算 |
| D07 | PENDING_APPROVAL | 按P0工作单元明确授权工程范围A，Commit/Push/PR/发布仍分开授权 |

`PROPOSED_REMOVALS: NONE`

若P0-A默认分享字段变化、P0-F旧接口演进或其他改造实际造成导出证据能力减少、默认关闭、隐藏、停用或破坏性兼容，另交十项审批单并保持PENDING_APPROVAL。本轮未提出具体减能力方案，不伪造APPROVED或审批记录。

## 尚未执行及阻塞

- not-run：P0-A–G生产失败复现/修复后验证、黄金差异、真实样本、500/800MB性能、新C1运行时Parity、生产build及发布门禁。无生产改动，本轮无需执行生产构建。
- blocked：P0生产实施授权缺失；Edge自动化尚无已确认避开凭据/钥匙串的安全路径，未启动，不改用Chrome。
- 真实样本未运行不自动判为环境blocked；取得匿名样本并人工复核后才改变状态。历史155项及报告自述不是外部独立复验。

P0_READINESS=READY_FOR_APPROVAL：各单元已有问题/范围/保护ID/复现设计/消费者/路径/差异/回退契约；不等于READY_TO_IMPLEMENT或发布通过。
