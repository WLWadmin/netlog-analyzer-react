# 临时交付目录整理

本轮按用户明确授权，将有效评审成果集中到 `reviews/workbench-v3/`，随后删除原 `workbench-parity-review-2026-11-11/`、`workbench-upgrade-2026-11-11/` 与 `.trae-html-share-packages/`。

- 最新评审文档、311 项 JSON/CSV、路由/开关、生成和验证脚本完整保留。
- 旧升级包的有效 UI 设计与合成原型 HTML/CSS/JavaScript 迁入本目录；原型相对路径同步修正。
- 旧包中已被 V3 收口替代的重复报告不再重复提交；历史验证记录在 current-review.md 和 validation.md 单列。
- 未使用的 ECharts/Mermaid 资源不复制；报告和原型实际使用系统字体、CSS 和本地脚本，无第三方图片或复制的新资源。
- 分享 ZIP 为可重建临时缓存。关联的其他原始 docs 文档保留，docs 忽略规则保持。

先完成新包验证再删除旧目录，删除后重新执行独立性检查。清理只针对上述临时交付物，不包含生产目录、其他 worktree、真实样本或实际功能。
