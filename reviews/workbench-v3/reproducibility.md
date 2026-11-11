# R5 · 可复现交付

在项目根目录执行以下命令，使用现有 Python 3、Node 和项目 node_modules 中的 jsdom；未新增依赖。

```bash
python3 reviews/workbench-v3/assets/build-review.py
python3 reviews/workbench-v3/assets/verify-review.py
```

单独复核离线交互：

```bash
node reviews/workbench-v3/assets/verify-dom.cjs
```

若项目依赖尚未安装，先按项目既有流程执行 `npm ci`。缺少依赖时不能凭历史结果判定通过。

交付目录内的 [报告](index.html)、[矩阵](feature-matrix.html) 和 [原型](prototype/index.html) 可离线打开，不依赖旧目录、网络或外部字体。全部 CSS/JavaScript 位于本目录 assets 或 prototype/assets。JSON、CSV、路由、整改与 P0 文档均与报告同目录。

[实际检查记录](review-checks.json) 记录执行时间、四态、检查数量和交付内容 SHA256（排除记录自身）；源码 SHA 固定在矩阵中。验证脚本检查 311 项 ID、JSON/CSV/HTML 一致性、P0 引用、本地链接与锚点、合成原型 DOM、公开发布文件范围、敏感模式、行尾空白，以及评审目录之外相对基线的零差异。

脚本运行会刷新 review-checks.json 的时间及工作 HEAD；重建报告使用当前评审文档，路由与开关通过 git show 读取固定源码基线。本地复验不能自动等同外部独立 Review。

DOM 检查不加载网络、不启动浏览器、不访问浏览器配置或钥匙串。历史 155 项生产测试未在本轮重跑；生产修复、真实样本、大文件性能、Edge 和 C1 生产运行时 Gate 仍未运行。
