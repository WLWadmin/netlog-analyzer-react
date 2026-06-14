/**
 * Go 服务日志解析相关常量
 * 包含 URL 友好名称映射、错误码知识库等
 */

// URL 友好名称映射
export interface URLFriendlyName {
  pattern: RegExp;
  name: string;
}

export const URL_FRIENDLY_NAMES: URLFriendlyName[] = [
  { pattern: /drive\.weixin\.qq\.com\/webdisk\/download/, name: '从微盘下载文件' },
  { pattern: /drive\.weixin\.qq\.com\/diskagent\/download/, name: '从微盘下载文件' },
  { pattern: /doc\.weixin\.qq\.com\/disk\/getbannerinfo/, name: '获取微盘信息' },
  { pattern: /open\.feishu\.cn.*\/file_metas/, name: '获取文件元信息' },
  { pattern: /open\.feishu\.cn.*\/migrations\/.*\/files/, name: '上传文件到飞书' },
  { pattern: /open\.feishu\.cn.*\/temporary_files\/upload/, name: '上传临时文件' },
];

/**
 * 根据 URL 获取友好名称
 */
export function getFriendlyName(url: string): string {
  for (const mapping of URL_FRIENDLY_NAMES) {
    if (mapping.pattern.test(url)) {
      return mapping.name;
    }
  }
  // 无法匹配时，返回简化后的 path
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    // 取最后一段路径作为名称
    const segments = path.split('/').filter(Boolean);
    if (segments.length > 0) {
      return segments[segments.length - 1];
    }
    return urlObj.hostname;
  } catch {
    return url;
  }
}

// 错误诊断知识库
export interface ErrorDiagnosis {
  statusCode: number | string;
  domainPattern?: RegExp;
  description: string;
  suggestion: string;
}

export const ERROR_DIAGNOSIS: ErrorDiagnosis[] = [
  {
    statusCode: 403,
    domainPattern: /open\.feishu\.cn/,
    description: '飞书应用权限不足',
    suggestion: '建议检查飞书应用权限配置，确认已申请相关 API 权限，或联系飞书客服',
  },
  {
    statusCode: 403,
    domainPattern: /(drive|doc)\.weixin\.qq\.com/,
    description: '微盘风控限流',
    suggestion: '单个用户每天约 200 次导出/下载限制，建议拆分迁移任务或次日重试，或联系企业微信服务同学解除限流',
  },
  {
    statusCode: 403,
    description: '权限不足或访问被拒绝',
    suggestion: '建议检查相关权限配置，或联系客服或工作人员协助排查',
  },
  {
    statusCode: 429,
    description: '请求频率过高',
    suggestion: '降低并发请求数，或联系服务提供方调整限流策略',
  },
  {
    statusCode: 500,
    description: '服务端内部错误',
    suggestion: '稍后重试，如持续出现请联系客服或工作人员',
  },
  {
    statusCode: 502,
    description: '网关错误',
    suggestion: '服务端可能暂时不可用，稍后重试，如持续出现请联系客服',
  },
  {
    statusCode: 503,
    description: '服务不可用',
    suggestion: '服务端可能正在维护或过载，稍后重试，如持续出现请联系客服',
  },
  {
    statusCode: 504,
    description: '网关超时',
    suggestion: '服务端响应超时，检查网络状况或稍后重试',
  },
  {
    statusCode: 401,
    description: '未授权访问',
    suggestion: '检查认证信息是否有效，或重新登录后重试',
  },
  {
    statusCode: 404,
    description: '请求的资源不存在',
    suggestion: '检查请求地址是否正确，或确认资源是否已被删除',
  },
];

/**
 * 根据状态码和域名获取诊断建议
 */
export function getErrorDiagnosis(statusCode: number, domain: string): ErrorDiagnosis | null {
  // 先尝试精确匹配（状态码 + 域名）
  for (const diagnosis of ERROR_DIAGNOSIS) {
    if (diagnosis.statusCode === statusCode && diagnosis.domainPattern && diagnosis.domainPattern.test(domain)) {
      return diagnosis;
    }
  }
  // 再尝试仅匹配状态码
  for (const diagnosis of ERROR_DIAGNOSIS) {
    if (diagnosis.statusCode === statusCode && !diagnosis.domainPattern) {
      return diagnosis;
    }
  }
  return null;
}

/**
 * 获取未知错误的默认建议
 */
export function getUnknownErrorSuggestion(): string {
  return '建议联系客服或工作人员协助排查';
}

// 耗时区间分布配置
export const DURATION_RANGES = [
  { label: '< 100ms', min: 0, max: 100 },
  { label: '100-500ms', min: 100, max: 500 },
  { label: '500ms-1s', min: 500, max: 1000 },
  { label: '1-5s', min: 1000, max: 5000 },
  { label: '> 5s', min: 5000, max: Infinity },
];
