/**
 * Go 服务日志解析相关常量
 * 仅用于内容展示：URL 友好名称映射、耗时区间等。
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

// 耗时区间分布配置
export const DURATION_RANGES = [
  { label: '< 100ms', min: 0, max: 100 },
  { label: '100-500ms', min: 100, max: 500 },
  { label: '500ms-1s', min: 500, max: 1000 },
  { label: '1-5s', min: 1000, max: 5000 },
  { label: '> 5s', min: 5000, max: Infinity },
];
