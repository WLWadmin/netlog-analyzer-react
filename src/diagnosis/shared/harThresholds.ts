/**
 * HAR 诊断启发式阈值配置
 * 集中管理所有 HAR 适配层的阈值，避免魔法数字散落
 */

// ========== 诊断阈值：用于判断是否存在问题 ==========
export const HAR_DIAG_THRESHOLDS = {
  /** DNS 阶段慢阈值（ms） */
  dnsSlow: 500,
  /** TCP 连接阶段慢阈值（ms） */
  connectSlow: 500,
  /** TLS/SSL 阶段慢阈值（ms） */
  sslSlow: 500,
  /** TTFB（wait）慢阈值（ms） */
  ttfbSlow: 800,
  /** 下载阶段慢阈值（ms） */
  receiveSlow: 1000,
  /** 浏览器阻塞慢阈值（ms） */
  blockedSlow: 500,
  /** 总耗时慢请求阈值（ms） */
  totalSlow: 1000,
  /** 总耗时严重慢请求阈值（ms） */
  totalVerySlow: 3000,
  /** 重定向耗时慢阈值（ms） */
  redirectSlow: 500,
  /** 大资源阈值（bytes） */
  largeResource: 1024 * 1024,
  /** Cookie 体积过大阈值（bytes） */
  cookieLarge: 2000,
  /** Server-Timing 总耗时慢阈值（ms） */
  serverTimingSlow: 500,
} as const;

// ========== 证据关联阈值：用于筛选相关请求 ==========
export const HAR_EVIDENCE_THRESHOLDS = {
  /** 归因证据：服务端相关请求筛选阈值（wait > N） */
  attributionServerWait: 800,
  /** 归因证据：DNS 相关请求筛选阈值（dns > N） */
  attributionDns: 500,
  /** 归因证据：网络相关请求筛选阈值（dns/connect > N） */
  attributionNetworkDns: 500,
  attributionNetworkConnect: 500,
  /** 归因证据：客户端相关请求筛选阈值（blocked > N） */
  attributionClientBlocked: 500,
  /** 阶段证据：最多展示相关请求数 */
  maxRelatedRequestsPerPhase: 10,
  /** 归因证据：最多展示相关请求数 */
  maxRelatedRequestsPerAttr: 5,
} as const;

// ========== 严重度分级阈值 ==========
export const HAR_SEVERITY_THRESHOLDS = {
  /** 缓存命中率偏低阈值（%） */
  cacheRateLow: 50,
  /** 缓存命中率判定需要的最小请求数 */
  cacheRateMinRequests: 10,
  /** 大资源未压缩阈值（bytes） */
  uncompressedLargeMinBytes: 1024 * 1024,
} as const;
