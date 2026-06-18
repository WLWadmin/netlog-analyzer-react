// ============================================================
// 分析阈值常量 - 统一管理所有硬编码阈值
// ============================================================

/** 慢请求阈值（毫秒） */
export const SLOW_REQUEST_MS = 3000;

/** 较慢请求阈值（毫秒） */
export const MODERATE_REQUEST_MS = 1000;

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

/** SSL 握手慢阈值（毫秒） */
export const SLOW_SSL_MS = 300;

/** SSL 握手非常慢阈值（毫秒） */
export const VERY_SLOW_SSL_MS = 1000;
