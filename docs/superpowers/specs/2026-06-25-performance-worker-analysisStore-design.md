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
2. 主线程只保存：`analysisId`、`summary`、`counts`、当前页数据（分页结果）。
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
  - `result`（现有解析结果，可视为 summary 的上层结构）
  - `sourceGraph`（惰性构建/缓存）
  - `eventIndex`（惰性构建/缓存，且避免把大 searchText 全量复制到索引里）

主线程侧：

- 仅保存：
  - `analysisId`
  - `summary`（可先复用现有 `AnalysisResult`/`HarAnalysisResult` 结构，但必须确保其中不包含全量 events 引用）
  - `counts`（eventCount、requestCount 等）
  - 当前 tab 的分页数据（如 events 的当前页、source chain 列表的当前页）

## Worker Store 设计

### 数据结构

```ts
// src/workers/analysisWorker.ts（示意）
export type AnalysisKind = 'netlog' | 'har';

interface StoredNetlogAnalysis {
  kind: 'netlog';
  rawData: unknown;
  events: ParsedEvent[];
  result: AnalysisResult; // 作为 summary 输出
  // lazy cache
  eventIndex?: WorkerEventIndex;
  sourceGraph?: SourceGraph;
}

interface StoredHarAnalysis {
  kind: 'har';
  rawData: unknown;
  result: HarAnalysisResult;
}

type StoredAnalysis = StoredNetlogAnalysis | StoredHarAnalysis;

const analysisStore = new Map<string, StoredAnalysis>();
```

### 生命周期

1. `parse-netlog` / `parse-har`：
   - 解析完成后 `keepAnalysis()` 生成 `analysisId` 并写入 store
   - 返回 `analysisId + summary + counts (+ rawDataId)`
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
  summary: AnalysisResult;
  eventCount: number;
  requestCount: number;
  rawDataId: string; // RawEvidence 继续沿用 rawDataId-only 模式
}

export interface ParseHarSuccessPayload {
  analysisId: string;
  summary: HarAnalysisResult;
  requestCount: number;
  rawDataId: string;
}
```

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
    pageSize: number;
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

export interface QueryEventsResponsePayload {
  total: number;
  page: number;
  pageSize: number;
  items: ParsedEvent[]; // 当前页数据（限制大小）
  facets?: {
    phases: string[];
    sourceTypes: string[];
    // paramFields: 可选（如果仍可从 index 提供轻量字段集合）
    paramFields?: string[];
  };
}
```

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

### RawEvidence（延续 rawDataId-only）

保留现有：
- `search-raw-json`
- `get-raw-structure`
- `get-raw-value`
- `release-raw-data`（可作为 rawData 子资源释放；推荐最终统一为 release-analysis 释放其子资源）

约束：
- 禁止把完整 raw JSON 回传主线程（只回结构概要、搜索 matches、字段值预览）。

## UI 侧改造

### App state（硬约束）

1. App 不再 `useState<ParsedEvent[]>` 持有全量 events。
2. App 在 netlog 上传成功后只保存：
   - `netlogAnalysisId`
   - `netlogSummary`
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

## 迁移步骤（实现顺序建议）

1. Worker：引入 `analysisStore`，实现 `parse-*` 写入 store，并调整 parse response（不回传 events/rawPayload）。
2. Worker：实现 `release-analysis`。
3. Worker：实现 `query-events`（先支持核心筛选），并设计轻量索引结构（避免 params stringify）。
4. Worker：实现 `query-source-chains`/`get-source-chain-detail`（sourceGraph lazy build + cache）。
5. Main：App 改为保存 `analysisId+summary+counts`，并在 reset/替换时 release。
6. Main：EventsTab 改为 worker query，移除 `buildEventIndex(events)` 主线程路径（保留代码但 feature flag 关闭入口）。
7. Main：SourceChainViewer 改为 worker query，移除主线程 `buildSourceGraph(events)` 路径。
8. 最后做 `rg` 验收与 `tsc/test/build`。

## 验收清单

1. `tsc --noEmit` 通过
2. `CI=true npm test -- --watchAll=false` 通过
3. `npm run build` 通过
4. 大 NetLog 下切换 Events / SourceChain / RawEvidence 不应长时间无响应
5. `rg -n "setEvents|useState<ParsedEvent\\[\\]>|<EventsTab events=|buildEventIndex\\(events\\)|buildSourceGraph\\(events" src` 无匹配（或只存在于“已被 feature flag 彻底隔离且不会走到的 dead code”，但推荐直接移除调用路径）

