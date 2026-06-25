# 大文件性能专项：Worker analysisStore 架构改造设计（方案 A）

> 目标：根治大文件（NetLog 数十万 events）场景下主线程内存过高、切 Tab 卡顿/无响应问题。  
> 核心原则：Worker 持有大数据，主线程只持有 `analysisId + summary + 当前视图分页数据`。

## 1. 背景问题

当前项目虽然已把 JSON.parse 等部分逻辑迁入 Worker，但仍存在几个根因：

1. 主线程 React state 长期持有完整 `events: ParsedEvent[]`，大文件下内存暴涨。
2. `EventsTab` 在主线程构建 `eventIndex`，切 Tab 或 props 变化时容易重算。
3. `SourceChainViewer` 在主线程构建 `sourceGraph`，会同步遍历全量 events。
4. Worker 仍可能回传过大的 `events/raw/result` 对象，导致“解析在 Worker，但大对象仍进主线程”。

## 2. 本期目标

必须满足：

1. Worker 内部保存 `rawData/events/result/sourceGraph/eventIndex` 等大对象。
2. 主线程只保存 `analysisId`、瘦身 `summary`、`counts`、当前页数据。
3. App 不再长期保存完整 `ParsedEvent[]`。
4. Events / SourceChain / RawEvidence / Diagnosis 都改为按需 query。
5. reset / 重新上传必须释放旧 `analysisId`，避免 Worker store 泄漏。
6. 通过 `tsc --noEmit`、`CI=true npm test -- --watchAll=false`、`npm run build`。

非目标：

1. 本期不新增诊断能力，只做性能架构改造。
2. 不要求立即恢复全部重型功能，但代码不删除，保留恢复入口。
3. 不做 SharedArrayBuffer 等跨线程共享内存方案。

## 3. 目标架构

Worker 侧：

- 解析文件后生成 `analysisId`。
- 大对象写入 `analysisStore`。
- `sourceGraph/eventIndex` 懒构建并缓存在 Worker。
- 对外只返回轻量 summary、分页 preview、单条详情。

主线程侧：

- App 只保存 `analysisId`、`summary`、`counts`。
- 当前 Tab 只保存当前页 preview。
- 切 Tab 不触发全量 events 遍历、全量 sourceGraph 构建、全量 raw JSON 克隆。

```ts
type AnalysisKind = 'netlog' | 'har';

interface StoredNetlogAnalysis {
  kind: 'netlog';
  rawData: unknown;
  events: ParsedEvent[];
  result: AnalysisResult; // Worker 内部完整结果，不整体回传主线程
  summary: NetlogSummary; // 主线程可持有的瘦身摘要
  eventIndex?: WorkerEventIndex;
  sourceGraph?: SourceGraph;
}

interface StoredHarAnalysis {
  kind: 'har';
  rawData: unknown;
  result: HarAnalysisResult;
  summary: HarSummary;
}

const analysisStore = new Map<string, StoredNetlogAnalysis | StoredHarAnalysis>();
```

## 4. 关键性能防线

这几条是防止“改了架构但仍然卡”的硬约束：

1. `summary` 必须瘦身  
   不能直接复用完整 `AnalysisResult/HarAnalysisResult`。`summary` 只保留统计、诊断结论、少量 topN evidence preview，不包含完整 `events/urlRequests/sslEvents/proxyEvents/cacheEvents/http2Events/quicEvents/rawData`。

2. Events 分页只返回 preview  
   `query-events` 不返回 `ParsedEvent[]`，只返回 `EventRowPreview[]`。完整 params 通过 `get-event-detail` 单条懒加载。

3. Diagnosis / 请求详情也必须 query 化  
   诊断卡、请求列表、生命周期卡片不能再依赖完整 `events/urlRequests`，只能拿 summary、分页 preview 或单条 detail。

4. 所有查询必须有上限  
   Worker 强制限制 `pageSize`、`maxMatches`、`maxPreviewChars`。UI 过滤需要 debounce，并忽略过期响应。

5. Feature flag 关闭时必须断开真实数据路径  
   隐藏按钮不够，组件不能在 render/useMemo/useEffect 中提前构建重型数据。

## 5. Worker 协议骨架

### 5.1 Parse 返回

```ts
interface ParseNetlogSuccessPayload {
  analysisId: string;
  summary: NetlogSummary;
  eventCount: number;
  requestCount: number;
  rawDataId: string;
}

interface ParseHarSuccessPayload {
  analysisId: string;
  summary: HarSummary;
  requestCount: number;
  rawDataId: string;
}
```

### 5.2 释放

```ts
interface ReleaseAnalysisRequest {
  type: 'release-analysis';
  id: string;
  payload: { analysisId?: string; all?: boolean };
}
```

### 5.3 Events 查询

```ts
interface QueryEventsRequest {
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
      keyword?: string; // 默认只匹配轻量字段，不 stringify params
      paramField?: string;
    };
  };
}

interface EventRowPreview {
  eventKey: string;
  time: string;
  type: number;
  typeName: string;
  phase: string;
  sourceId?: string | number;
  sourceType?: string;
  errorCode?: string | number;
  url?: string;
  method?: string;
  shortParams?: Record<string, unknown>;
}

interface QueryEventsResponsePayload {
  total: number;
  page: number;
  pageSize: number;
  items: EventRowPreview[];
  facets?: { phases: string[]; sourceTypes: string[]; paramFields?: string[] };
}

interface GetEventDetailRequest {
  type: 'get-event-detail';
  id: string;
  payload: { analysisId: string; eventKey: string; maxParamChars?: number };
}
```

### 5.4 SourceChain 查询

```ts
interface QuerySourceChainsRequest {
  type: 'query-source-chains';
  id: string;
  payload: {
    analysisId: string;
    page: number;
    pageSize: number;
    filters?: { keyword?: string; mode?: 'all' | 'error' | 'slow' };
  };
}

interface GetSourceChainDetailRequest {
  type: 'get-source-chain-detail';
  id: string;
  payload: { analysisId: string; rootId: number };
}
```

约束：列表只返回链路摘要；详情只返回单条链路 path nodes；全量展开默认关闭。

### 5.5 Diagnosis / 请求详情查询

```ts
type WorkerQueryType =
  | 'query-diagnosis-summary'
  | 'query-request-page'
  | 'get-request-detail'
  | 'get-event-evidence';
```

用途：

- `query-diagnosis-summary`：诊断页摘要与 evidence preview。
- `query-request-page`：请求列表分页 preview。
- `get-request-detail`：单个请求详情、生命周期、关联事件。
- `get-event-evidence`：按 evidence id 拉取少量证据 preview。

### 5.6 RawEvidence 查询

继续沿用 rawDataId-only：

- `get-raw-structure`
- `get-raw-value`
- `search-raw-json`
- `release-raw-data`（后续可统一到 `release-analysis`）

约束：禁止回传完整 raw JSON；搜索和值预览必须限制 `maxMatches/maxDepth/maxPreviewChars` 并返回 `truncated`。

## 6. UI 改造范围

### App

- 移除长期 `useState<ParsedEvent[]>`。
- 保存 `netlogAnalysisId/harAnalysisId`、瘦身 summary、counts。
- reset 或替换文件时调用 `release-analysis`。

### EventsTab

- Props 从 `events` 改为 `analysisId`。
- 打开 Tab 后请求 `query-events(page=1,pageSize=100)`。
- 过滤条件变更后 debounce 查询。
- 点击事件后调用 `get-event-detail` 拉取 params 预览。

暂时弱化：

- 时间线视图：feature flag 默认关闭。
- 上下文窗口：改为 `query-event-context` 或默认关闭。
- 全量 params 搜索：feature flag 默认关闭。

### SourceChainViewer

- Props 从 `(events, urlRequests)` 改为 `analysisId`。
- 列表走 `query-source-chains`。
- 展开单条链路走 `get-source-chain-detail`。
- 全量展开默认关闭。

### Diagnosis / 请求详情

- 只接收 summary / preview。
- 请求列表分页查询。
- 单个请求生命周期和证据事件按需查询。

### RawEvidenceExplorer

- 只接收 `rawDataId` 或 `analysisId`。
- 结构、字段值、搜索都通过 Worker 查询。

## 7. Feature Flags

```ts
export const ENABLE_EVENTS_TIMELINE = false;
export const ENABLE_EVENTS_CONTEXT = false;
export const ENABLE_EVENTS_FULL_PARAMS_SEARCH = false;
export const ENABLE_SOURCECHAIN_FULL_EXPAND = false;
```

要求：

- flag false 时不渲染重功能入口。
- 更重要的是：flag false 时不能预先构建重型数据。
- 后续恢复功能时，也必须走 Worker 分页/分批 query。

## 8. 实施顺序

1. Worker：引入 `analysisStore`，parse 后写入 store。
2. Worker：定义 `NetlogSummary/HarSummary`，parse response 只返回瘦身 summary。
3. Worker：实现 `release-analysis`。
4. Worker：实现 `query-events/get-event-detail`。
5. Worker：实现 `query-source-chains/get-source-chain-detail`。
6. Worker：补齐 Diagnosis / 请求详情按需查询。
7. Main：App 改为保存 `analysisId + summary + counts`。
8. Main：EventsTab 改为 Worker query。
9. Main：SourceChainViewer 改为 Worker query。
10. Main：Diagnosis / 请求详情改为 summary + query。
11. 做代码搜索验收、性能手测、`tsc/test/build`。

## 9. 验收清单

功能验收：

1. `tsc --noEmit` 通过。
2. `CI=true npm test -- --watchAll=false` 通过。
3. `npm run build` 通过。
4. HAR / NetLog / Log 原有基础功能可用；Log 仍仅做内容展示，不参与网络诊断。

性能验收：

1. 大 NetLog 下切换 Events / SourceChain / RawEvidence 无秒级无响应。
2. 常规 Tab 切换目标 < 500ms。
3. Chrome Task Manager 中页面内存相比当前 1.1GB 明显下降。
4. 主线程内存不再随 events 数量线性上涨。
5. Performance 录制中，Tab 切换不触发主线程全量遍历 `events/sourceGraph/rawData`。

代码搜索验收：

```bash
rg -n "setEvents|useState<ParsedEvent\\[\\]>|<EventsTab events=|buildEventIndex\\(events\\)|buildSourceGraph\\(events" src
rg -n "summary: AnalysisResult|summary: HarAnalysisResult|items: ParsedEvent\\[\\]" src
```

以上命令应无匹配；如有匹配，必须确认它不在真实运行路径中。
