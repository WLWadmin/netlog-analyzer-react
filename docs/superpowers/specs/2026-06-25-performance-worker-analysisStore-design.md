# 大文件性能专项：Worker analysisStore 架构改造设计（方案 A）

> 目标：根治大文件（NetLog 数十万 events）场景下主线程内存过高与切 Tab 卡顿/无响应问题。  
> 本设计严格遵循 `docs/performance-optimization-prompts-key-code.md` 的“Worker 持有大数据、主线程按需取视图数据”原则。

## 背景与问题

当前项目虽然已把 JSON.parse 等部分逻辑迁入 Worker，但仍存在以下根因：

1. 主线程 React state 长期持有完整 `events: ParsedEvent[]`（几十万条）导致内存暴涨。
2. `EventsTab` 在主线程 `useMemo(() => buildEventIndex(events))` 构建索引，切 Tab 或 props 变化时容易触发重算与阻塞。
3. `SourceChainViewer` 在主线程 `useMemo(() => buildSourceGraph(events, urlRequests))` 同步遍历全量 events，切 Tab 卡顿明显。
4. Worker 仍回传过大的对象（events/raw），使“解析搬到 Worker”并未真正把大对象移出主线程。

## 总目标与硬约束（本专项验收）

### 必须满足

1. Worker 持有 `rawData/events/sourceGraph/eventIndex` 等大对象。
2. 主线程只保存：`analysisId`、瘦身后的 `summary`、`counts`、当前页数据（分页结果）。
3. App 不再长期保存完整 `ParsedEvent[]`。
4. `EventsTab` 改为 `query-events`：分页/筛选在 Worker 侧执行。
5. `SourceChainViewer` 改为 `query-source-chains` / `get-source-chain-detail`：链路构建与查询在 Worker 侧执行。
6. `RawEvidence` 继续 `rawDataId-only`，不回传完整 raw JSON；字段结构/取值/搜索均通过 Worker 查询且返回轻量预览。
7. 重型功能（时间线视图、上下文窗口、全量 params 搜索、SourceChain 全量展开）允许暂时弱化，但：
   - 不删除原功能代码；
   - 通过 feature flag 默认关闭或“加载详情”按钮延后执行；
   - 保留后续恢复的扩展点。
8. reset/重新上传必须 `release-analysis`，释放 Worker store（避免内存泄漏）。
9. 必须通过：`tsc --noEmit`、`CI=true npm test -- --watchAll=false`、`npm run build`。
10. 完成后执行以下检查不得再出现主线程大数据路径：
   - `rg -n "setEvents|useState<ParsedEvent\\[\\]>|<EventsTab events=|buildEventIndex\\(events\\)|buildSourceGraph\\(events" src`

### 非目标（本期不做）

1. 不新增诊断能力（不引入新的结论型诊断，仅做性能改造）。
2. 不要求立即恢复所有重型功能；但必须可恢复，且代码不删除。
3. 不做跨线程共享内存（SharedArrayBuffer 等），先采用 “Worker store + query”。

## 目标架构

Worker 侧：

- 解析后把大对象写入 `analysisStore`：
  - `rawData`（原始 JSON）
  - `events`（NetLog 全量事件）
  - `result`（Worker 内部完整分析结果，不直接整体回传主线程）
  - `sourceGraph`（惰性构建/缓存）
  - `eventIndex`（惰性构建/缓存，且避免把大 searchText 全量复制到索引里）

主线程侧：

- 仅保存：
  - `analysisId`
  - `summary`（必须是瘦身后的 `NetlogSummary`/`HarSummary`，不能直接复用包含大数组的完整 `AnalysisResult`）
  - `counts`（eventCount、requestCount 等）
  - 当前 tab 的分页数据（如 events 的当前页、source chain 列表的当前页）

> 关键约束：`summary` 只允许包含统计、诊断结论、少量 topN 证据与必要概览。不得包含完整 `events`、完整 `urlRequests`、完整 `sslEvents/proxyEvents/cacheEvents/http2Events/quicEvents` 等事件派生大数组；这些数据统一留在 Worker，由按需查询协议返回轻量预览或单条详情。

## Worker Store 设计

### 数据结构

```ts
// src/workers/analysisWorker.ts（示意）
export type AnalysisKind = 'netlog' | 'har';

interface StoredNetlogAnalysis {
  kind: 'netlog';
  rawData: unknown;
  events: ParsedEvent[];
  result: AnalysisResult; // Worker 内部完整结果，不直接整体 postMessage 给主线程
  summary: NetlogSummary; // 主线程可持有的瘦身摘要
  // lazy cache
  eventIndex?: WorkerEventIndex;
  sourceGraph?: SourceGraph;
}

interface StoredHarAnalysis {
  kind: 'har';
  rawData: unknown;
  result: HarAnalysisResult;
  summary: HarSummary;
}

type StoredAnalysis = StoredNetlogAnalysis | StoredHarAnalysis;

const analysisStore = new Map<string, StoredAnalysis>();
```

### 生命周期

1. `parse-netlog` / `parse-har`：
   - 解析完成后 `keepAnalysis()` 生成 `analysisId` 并写入 store
   - 返回 `analysisId + slim summary + counts (+ rawDataId)`
2. `release-analysis`：
   - `analysisId` 指定释放，或 `all` 全部释放
3. 替换新文件：
   - 主线程在新 parse 成功后，释放旧 `analysisId`
4. reset：
   - 主线程调用 `release-analysis({ all: true })`

## 协议（Worker ↔ Main）

在 `src/workers/protocols.ts` 增加/调整以下消息：

### 解析成功返回（不回传 events/rawData）

```ts
export interface ParseNetlogRequest { type: 'parse-netlog'; id: string; payload: string | unknown; }
export interface ParseHarRequest { type: 'parse-har'; id: string; payload: string | unknown; repairInfo?: unknown; }

export interface ParseNetlogSuccessPayload {
  analysisId: string;
  summary: NetlogSummary;
  eventCount: number;
  requestCount: number;
  rawDataId: string; // RawEvidence 继续沿用 rawDataId-only 模式
}

export interface ParseHarSuccessPayload {
  analysisId: string;
  summary: HarSummary;
  requestCount: number;
  rawDataId: string;
}
```

`NetlogSummary` / `HarSummary` 要显式定义为“主线程安全类型”，只保留：
- 文件级统计：请求数、错误数、DNS/Connect/SSL/TTFB 等摘要指标。
- 诊断结论：诊断卡片摘要、原因分类、严重程度、少量 evidence id。
- 少量 topN 列表：例如 top slow requests / top errors，单项必须是轻量 preview。

不得包含：
- `events: ParsedEvent[]`
- 完整 `urlRequests`
- 完整 `sslEvents/proxyEvents/cacheEvents/http2Events/quicEvents`
- 完整 raw JSON 或完整 params。

### 释放

```ts
export interface ReleaseAnalysisRequest {
  type: 'release-analysis';
  id: string;
  payload: { analysisId?: string; all?: boolean };
}
```

### Events 查询

```ts
export interface QueryEventsRequest {
  type: 'query-events';
  id: string;
  payload: {
    analysisId: string;
    page: number;
    pageSize: number; // Worker 强制 cap，建议最大 200 或 500
    filters?: {
      sourceId?: string;
      sourceType?: string;
      phase?: string;
      errorCode?: string;
      errorOnly?: boolean;
      // keyword: 暂时只支持轻量字段匹配（typeName/sourceType/sourceId/常见 error 字段）
      keyword?: string;
      // paramField: 暂时保留字段选择，但不做全量 params stringify 搜索（feature flag 控制）
      paramField?: string;
    };
  };
}

export interface EventRowPreview {
  eventKey: string; // 可用原始 index 或稳定组合 key
  time: string;
  type: number;
  typeName: string;
  phase: string;
  sourceId?: string | number;
  sourceType?: string;
  errorCode?: string | number;
  url?: string;
  method?: string;
  shortParams?: Record<string, unknown>; // 只放白名单小字段，不放完整 params
}

export interface QueryEventsResponsePayload {
  total: number;
  page: number;
  pageSize: number;
  items: EventRowPreview[]; // 当前页轻量数据，禁止返回完整 ParsedEvent/完整 params
  facets?: {
    phases: string[];
    sourceTypes: string[];
    // paramFields: 可选（如果仍可从 index 提供轻量字段集合）
    paramFields?: string[];
  };
}

export interface GetEventDetailRequest {
  type: 'get-event-detail';
  id: string;
  payload: { analysisId: string; eventKey: string; maxParamChars?: number };
}

export interface GetEventDetailResponsePayload {
  event: EventRowPreview;
  paramsPreview?: unknown;
  paramsTruncated: boolean;
}
```

查询约束：
- Worker 必须限制 `pageSize` 上限，不能信任 UI 入参。
- 默认 keyword 只匹配轻量索引字段，不对全量 `params` 做 `JSON.stringify`。
- UI 侧请求要带当前请求 id；过滤条件快速变化时，只接收最后一次请求的响应，旧响应直接丢弃。
- 如需查看完整 params，必须通过 `get-event-detail` 按单条事件懒加载，并限制 `maxParamChars`。

### SourceChain 查询

```ts
export interface QuerySourceChainsRequest {
  type: 'query-source-chains';
  id: string;
  payload: {
    analysisId: string;
    page: number;
    pageSize: number;
    filters?: { keyword?: string; mode?: 'all' | 'error' | 'slow' };
  };
}

export interface GetSourceChainDetailRequest {
  type: 'get-source-chain-detail';
  id: string;
  payload: { analysisId: string; rootId: number };
}
```

SourceChain 约束：
- `query-source-chains` 只返回链路摘要列表，不返回整棵图。
- `get-source-chain-detail` 只返回单条链路详情，必要时对 nodes 数量做上限与截断标记。
- 全量展开功能默认关闭；恢复时也必须分页或分批查询，不能一次性把完整 `sourceGraph` 克隆到主线程。

### Diagnosis / 请求详情查询

诊断页、请求详情、生命周期卡片不能继续隐式依赖完整 `events` 或完整 `urlRequests`。如现有组件需要这些数据，必须改为以下按需查询：

```ts
export interface QueryDiagnosisSummaryRequest {
  type: 'query-diagnosis-summary';
  id: string;
  payload: { analysisId: string };
}

export interface QueryRequestPageRequest {
  type: 'query-request-page';
  id: string;
  payload: {
    analysisId: string;
    page: number;
    pageSize: number; // Worker 强制 cap
    filters?: { keyword?: string; errorOnly?: boolean; slowOnly?: boolean };
  };
}

export interface GetRequestDetailRequest {
  type: 'get-request-detail';
  id: string;
  payload: { analysisId: string; requestId: string | number };
}

export interface GetEventEvidenceRequest {
  type: 'get-event-evidence';
  id: string;
  payload: { analysisId: string; evidenceIds: string[]; maxItems?: number };
}
```

约束：
- `DiagnosisTab` 只能接收 summary / evidence preview，不能接收完整 events。
- 请求列表只接收分页 preview；单个请求的生命周期、证据事件、raw params 通过详情接口按需加载。
- 诊断卡片中的 evidence 应保存 `eventKey/requestId/rawPath` 等引用，不保存完整大对象。

### RawEvidence（延续 rawDataId-only）

保留现有：
- `search-raw-json`
- `get-raw-structure`
- `get-raw-value`
- `release-raw-data`（可作为 rawData 子资源释放；推荐最终统一为 release-analysis 释放其子资源）

约束：
- 禁止把完整 raw JSON 回传主线程（只回结构概要、搜索 matches、字段值预览）。
- `search-raw-json` 必须限制 `maxMatches`、`maxDepth`、`maxPreviewChars`，并在结果中返回 `truncated` 标记。
- `get-raw-value` 默认只返回预览文本；用户点击“加载更多/复制详情”时再按上限继续请求。

## UI 侧改造

### App state（硬约束）

1. App 不再 `useState<ParsedEvent[]>` 持有全量 events。
2. App 在 netlog 上传成功后只保存：
   - `netlogAnalysisId`
   - `netlogSummary`（瘦身 summary，不是完整 AnalysisResult）
   - `netlogEventCount`（可选）
3. 切换 tab 不触发任何全量索引构建。
4. reset / 重新上传必须先 `release-analysis`。

### EventsTab 改造

Props：

- `EventsTab` 从 `events` props 改为 `analysisId` props。

行为：

1. tab 打开后：
   - 首次请求 `query-events(page=1,pageSize=100,filters=...)`
2. 过滤项变更：
   - 在 Worker 侧重新查询，不在主线程 build index
   - UI debounce 后发起查询，并忽略过期响应
3. 点击某条 event：
   - 调用 `get-event-detail` 拉取单条详情与 params 预览

保留核心功能：
- 分页列表（必须）
- `sourceId/sourceType/phase/net_error` 过滤（必须）

暂时弱化（不删代码）：

- 时间线视图：feature flag 默认关闭，入口隐藏或显示“启用高级视图（可能较慢）”
- 上下文窗口：feature flag 默认关闭，入口隐藏或改为 worker 查询 `query-event-context`
- 全量 params 搜索：feature flag 默认关闭；默认 keyword 只匹配轻量字段（避免对每个 event stringify params）

### SourceChainViewer 改造

Props：

- 从 `(events, urlRequests)` 改为 `analysisId`

行为：

1. 列表查询：`query-source-chains` 返回链路摘要（rootId/url/duration/depth/hasError 等）
2. 点开某条链路：调用 `get-source-chain-detail` 拉取完整 path nodes

暂时弱化（不删代码）：
- 全量展开：feature flag 默认关闭，保留“加载全部/展开全部”扩展点（后续可分页/虚拟化或后台分段加载）

### RawEvidenceExplorer

保持 rawDataId-only：
- UI 侧不保存完整 rawData
- 结构/字段值/搜索都通过 worker 请求（返回轻量预览）

## Feature Flags（默认关闭重功能）

建议新增 `src/constants/featureFlags.ts`：

```ts
export const ENABLE_EVENTS_TIMELINE = false;
export const ENABLE_EVENTS_CONTEXT = false;
export const ENABLE_EVENTS_FULL_PARAMS_SEARCH = false;
export const ENABLE_SOURCECHAIN_FULL_EXPAND = false;
```

注意：必须做到“不删代码”，而是：
- 入口隐藏（flag false 时不渲染按钮/Tab 视图）
- 或点击“加载详情”后才触发 heavy worker query

Feature flag 关闭时，组件不得在 render/useMemo/useEffect 中预先构建重型数据；按钮隐藏只是 UI 表现，真正的数据路径也必须断开。

## 迁移步骤（实现顺序建议）

1. Worker：引入 `analysisStore`，实现 `parse-*` 写入 store，并调整 parse response（不回传 events/rawPayload）。
2. Worker：定义 `NetlogSummary`/`HarSummary`，确保 parse response 只回传瘦身 summary。
3. Worker：实现 `release-analysis`。
4. Worker：实现 `query-events`/`get-event-detail`（先支持核心筛选），并设计轻量索引结构（避免 params stringify）。
5. Worker：实现 `query-source-chains`/`get-source-chain-detail`（sourceGraph lazy build + cache）。
6. Worker：补齐 `query-diagnosis-summary`/`query-request-page`/`get-request-detail` 等诊断与请求详情按需查询。
7. Main：App 改为保存 `analysisId+summary+counts`，并在 reset/替换时 release。
8. Main：EventsTab 改为 worker query，移除 `buildEventIndex(events)` 主线程路径（保留代码但 feature flag 关闭入口）。
9. Main：SourceChainViewer 改为 worker query，移除主线程 `buildSourceGraph(events)` 路径。
10. Main：Diagnosis/请求详情改为 summary + query，不再接收完整 events/urlRequests。
11. 最后做 `rg` 验收、性能手测与 `tsc/test/build`。

## 验收清单

1. `tsc --noEmit` 通过
2. `CI=true npm test -- --watchAll=false` 通过
3. `npm run build` 通过
4. 大 NetLog 下切换 Events / SourceChain / RawEvidence 不应长时间无响应；目标是 tab 切换交互无秒级 scripting 长任务，常规切换 < 500ms。
5. Chrome Task Manager 中页面内存相比当前 1.1GB 明显下降，且主线程内存不再随 events 数量线性上涨。
6. Performance 录制中，tab 切换不应触发主线程全量遍历 events/sourceGraph/rawData。
7. `rg -n "setEvents|useState<ParsedEvent\\[\\]>|<EventsTab events=|buildEventIndex\\(events\\)|buildSourceGraph\\(events" src` 无匹配（或只存在于“已被 feature flag 彻底隔离且不会走到的 dead code”，但推荐直接移除调用路径）
8. `rg -n "summary: AnalysisResult|summary: HarAnalysisResult|items: ParsedEvent\\[\\]" src` 无匹配，避免协议层再次把完整结果/完整事件页回传主线程。
