// ============================================================
// 分析阈值常量 - 统一管理所有硬编码阈值
// ============================================================

// ---- 分析阈值 ----

/** 慢请求阈值（毫秒） */
export const SLOW_REQUEST_MS = 3000;

/** 较慢请求阈值（毫秒） */
export const MODERATE_REQUEST_MS = 1000;

/** SSL 握手慢阈值（毫秒） */
export const SLOW_SSL_MS = 300;

/** SSL 握手非常慢阈值（毫秒） */
export const VERY_SLOW_SSL_MS = 1000;

// ---- 列表截断 ----

/** 预览型列表 Top N 截断 */
export const TOP_PREVIEW_COUNT = 10;

/** 总览 Top 请求截断 */
export const TOP_REQUESTS_COUNT = 20;

/** 性能瀑布 Top 截断 */
export const TOP_WATERFALL_COUNT = 30;

/** 时间线最大分组数 */
export const MAX_TIMELINE_GROUPS = 50;

/** 时间线每组最大事件数 */
export const MAX_TIMELINE_EVENTS_PER_GROUP = 20;

/** 单个 LogFlowGroup 展开后最大 entry 预览数 */
export const MAX_GROUP_ENTRY_PREVIEW = 100;

// ---- 加载更多（Load More）初始值与步长 ----

/** NetLog 瀑布流初始展示条数 */
export const NETLOG_WATERFALL_INITIAL_COUNT = 30;

/** NetLog 瀑布流每次加载步长 */
export const NETLOG_WATERFALL_LOAD_STEP = 30;

/** Log 流程分组初始展示条数 */
export const LOG_FLOW_INITIAL_COUNT = 50;

/** Log 流程分组每次加载步长 */
export const LOG_FLOW_LOAD_STEP = 30;

/** Log 原始日志初始展示条数 */
export const LOG_RAW_INITIAL_COUNT = 600;

/** Log 原始日志每次加载步长 */
export const LOG_RAW_LOAD_STEP = 300;

// ---- 防抖 / 延迟 ----

/** 搜索输入防抖（毫秒） */
export const SEARCH_DEBOUNCE_MS = 250;

/** 筛选 loading 最小展示时间（毫秒），低于此值不显示 spinner */
export const FILTER_SPINNER_DELAY_MS = 80;
