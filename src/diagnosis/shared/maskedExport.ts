/**
 * 脱敏导出工具
 * 用于导出诊断报告时自动隐藏敏感信息
 */

import type { DiagnosticCard } from './types';

// 需要脱敏的 Header 名称
const SENSITIVE_HEADERS = [
  'cookie',
  'authorization',
  'set-cookie',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-access-token',
  'x-session-id',
  'x-tt-token',
  'x-tt-session',
  'bearer',
  'proxy-authorization',
  'www-authenticate',
  'x-api-key',
  'x-app-token',
  'x-bd-token',
  'x-jwt-token',
];

// 需要脱敏的查询参数
const SENSITIVE_QUERY_PARAMS = [
  'token',
  'access_token',
  'refresh_token',
  'session_id',
  'sessionid',
  'sid',
  'key',
  'secret',
  'password',
  'passwd',
  'auth',
  'credential',
  'jwt',
  'ticket',
  'signature',
  'sign',
  'code',
];

const SENSITIVE_KEY_PATTERN = /(token|access[_-]?token|refresh[_-]?token|session[_-]?id|sessionid|sid|secret|password|passwd|auth|credential|jwt|ticket|signature|proxy-authorization|authorization|cookie|set-cookie)=([^&\s,;]+)/gi;
const SENSITIVE_COLON_KEY_PATTERN = /(["']?)(token|access[_-]?token|refresh[_-]?token|session[_-]?id|sessionid|sid|secret|password|passwd|auth|credential|jwt|ticket|signature|proxy-authorization|authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token|x-access-token|x-session-id|x-tt-token|x-tt-session|x-app-token|x-bd-token|x-jwt-token)\1\s*:\s*(["']?)[^"'\r\n,;}]+(?:\3)?/gi;
const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+\-/]+=*/gi;
const BASIC_PATTERN = /\b(Basic\s+)[A-Za-z0-9+/]+=*/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?<!\d)(?:\+?\d[\d\s-]{7,}\d)(?!\d)/g;


export type SensitiveDataLeak =
  | 'sensitive-key-value'
  | 'authorization-token'
  | 'email'
  | 'phone'
  | 'raw-source-or-args'
  | 'raw-body'
  | 'url-query'
  | 'local-path';

const RAW_BODY_PATTERN = /\b(?:request|response) body\b/i;
const RAW_SOURCE_PATTERN = /\b(?:sourceText|args)\s*[:=]\s*(?!\*{3})(?:["'{[]|[^\s])/i;
const URL_PATTERN = /https?:\/\/[^\s"'，。；]+/gi;
const URL_QUERY_PATTERN = /(?:https?:\/\/|file:\/\/|\/)[^\s"'，。；?]*\?[^\s"'，。；]+/i;
const UNIX_LOCAL_PATH_PATTERN = /(?:file:\/\/)?\/(?:Users|home|private|tmp|var\/folders)\/[^\s"'，。；]+/gi;
const WINDOWS_LOCAL_PATH_PATTERN = /[A-Za-z]:\\(?:[^\\\s"'，。；]+\\)+[^\\\s"'，。；]*/g;

function hasPhoneMatch(value: string): boolean {
  PHONE_PATTERN.lastIndex = 0;
  let match = PHONE_PATTERN.exec(value);
  while (match) {
    const separators = match[0].match(/[\s-]/g)?.length ?? 0;
    if (match[0].startsWith('+') || separators >= 2) return true;
    match = PHONE_PATTERN.exec(value);
  }
  return false;
}

function hasUnmaskedMatch(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  let match = pattern.exec(value);
  while (match) {
    if (!match[0].includes('***') && !match[0].includes('[phone masked]')) return true;
    if (!pattern.global) return false;
    match = pattern.exec(value);
  }
  return false;
}

export function findSensitiveDataLeaks(value: string): SensitiveDataLeak[] {
  const leaks: SensitiveDataLeak[] = [];
  if (hasUnmaskedMatch(SENSITIVE_KEY_PATTERN, value)
    || hasUnmaskedMatch(SENSITIVE_COLON_KEY_PATTERN, value)) {
    leaks.push('sensitive-key-value');
  }
  if (hasUnmaskedMatch(BEARER_PATTERN, value) || hasUnmaskedMatch(BASIC_PATTERN, value)) {
    leaks.push('authorization-token');
  }
  if (hasUnmaskedMatch(EMAIL_PATTERN, value)) leaks.push('email');
  if (hasPhoneMatch(value)) leaks.push('phone');
  if (RAW_SOURCE_PATTERN.test(value)) leaks.push('raw-source-or-args');
  if (RAW_BODY_PATTERN.test(value)) leaks.push('raw-body');
  const unmaskedQueryText = value.replace(/\?\[query masked\]/g, '');
  if (URL_QUERY_PATTERN.test(unmaskedQueryText)) leaks.push('url-query');
  UNIX_LOCAL_PATH_PATTERN.lastIndex = 0;
  WINDOWS_LOCAL_PATH_PATTERN.lastIndex = 0;
  if (UNIX_LOCAL_PATH_PATTERN.test(value) || WINDOWS_LOCAL_PATH_PATTERN.test(value)) {
    leaks.push('local-path');
  }
  return leaks;
}

/**
 * 脱敏字符串：保留前 4 个字符，其余用 *** 替代
 */
function maskString(value: string): string {
  if (!value || value.length <= 4) return '***';
  return value.substring(0, 4) + '***';
}

/**
 * 脱敏 URL 中的敏感查询参数
 */
export function maskUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    for (const [key, value] of urlObj.searchParams.entries()) {
      if (SENSITIVE_QUERY_PARAMS.some(p => key.toLowerCase().includes(p))) {
        urlObj.searchParams.set(key, maskString(value));
      }
    }
    return urlObj.toString();
  } catch {
    return url;
  }
}

/**
 * 脱敏 Header 值
 */
export function maskHeader(name: string, value: string): string {
  if (SENSITIVE_HEADERS.some(h => name.toLowerCase() === h)) {
    return maskString(value);
  }
  return value;
}

/**
 * 脱敏诊断卡片中的证据值
 */
export function maskEvidenceValue(value: string): string {
  let masked = value;

  // 脱敏 URL
  if (masked.startsWith('http://') || masked.startsWith('https://')) {
    masked = maskUrl(masked);
  }

  // 脱敏 key=value 形式的敏感片段，兼容 URL、Header、日志片段
  masked = masked.replace(SENSITIVE_KEY_PATTERN, (match, key) => `${key}=***`);
  // Header 与 JSON 常使用 key: value；保留 key 和原有引号，避免破坏结构。
  masked = masked.replace(
    SENSITIVE_COLON_KEY_PATTERN,
    (_match, keyQuote, key, valueQuote) => (
      `${keyQuote}${key}${keyQuote}: ${valueQuote}***${valueQuote}`
    ),
  );

  // 脱敏 Authorization 常见格式
  masked = masked.replace(BEARER_PATTERN, '$1***');
  masked = masked.replace(BASIC_PATTERN, '$1***');

  // 脱敏可能出现的邮箱与长电话号码，降低协作摘要泄露风险
  masked = masked.replace(EMAIL_PATTERN, '***@***');
  masked = masked.replace(PHONE_PATTERN, (match) => {
    const digits = match.replace(/\D/g, '');
    return digits.length >= 8 ? '[phone masked]' : match;
  });

  return masked;
}


/**
 * 严格脱敏诊断文本：在既有证据脱敏基础上移除全部 URL query 和本地绝对路径。
 */
export function sanitizeDiagnosisText(value: string): string {
  let sanitized = maskEvidenceValue(value);
  sanitized = sanitized.replace(URL_PATTERN, url => {
    try {
      const parsed = new URL(url);
      if (!parsed.search) return url;
      parsed.search = '';
      return `${parsed.toString()}?[query masked]`;
    } catch {
      return url;
    }
  });
  sanitized = sanitized.replace(UNIX_LOCAL_PATH_PATTERN, '[local path masked]');
  sanitized = sanitized.replace(WINDOWS_LOCAL_PATH_PATTERN, '[local path masked]');
  return sanitized;
}

/**
 * 生成脱敏后的诊断摘要文本（用于导出）
 */
export function generateMaskedReport(cards: DiagnosticCard[]): string {
  const lines: string[] = [];

  lines.push('# 网络诊断报告');
  lines.push(`> 生成时间：${new Date().toLocaleString()}`);
  lines.push(`> 诊断卡片数：${cards.length}`);
  lines.push('');

  const criticalCount = cards.filter(c => c.severity === 'critical').length;
  const warningCount = cards.filter(c => c.severity === 'warning').length;
  const infoCount = cards.filter(c => c.severity === 'info').length;

  lines.push(`## 概览`);
  lines.push(`- 严重：${criticalCount} 个`);
  lines.push(`- 警告：${warningCount} 个`);
  lines.push(`- 提示：${infoCount} 个`);
  lines.push('');

  cards.forEach((card, index) => {
    lines.push(`## ${index + 1}. ${card.title}`);
    lines.push('');
    lines.push(`**严重程度**：${card.severity === 'critical' ? '严重' : card.severity === 'warning' ? '警告' : '提示'}`);
    lines.push(`**置信度**：${card.confidence === 'high' ? '高' : card.confidence === 'medium' ? '中' : '低'}`);
    lines.push(`**影响范围**：${card.scope.summary}`);
    if (card.mergedSources && card.mergedSources.length > 0) {
      lines.push(`**融合来源**：${card.mergedSources.join(' + ')}`);
    }
    lines.push('');
    lines.push(`### 诊断结论`);
    lines.push(card.conclusion);
    lines.push('');

    if (card.evidence.length > 0) {
      lines.push('### 证据链');
      card.evidence.forEach(ev => {
        lines.push(`- **${ev.label}**：${maskEvidenceValue(ev.value)}`);
        if (ev.detail) {
          lines.push(`  - 详情：${maskEvidenceValue(ev.detail)}`);
        }
        if (ev.fieldPath) {
          lines.push(`  - 字段路径：${ev.fieldPath}`);
        }
      });
      lines.push('');
    }

    if (card.confidenceFactors && card.confidenceFactors.length > 0) {
      lines.push('### 置信度依据');
      card.confidenceFactors.forEach(factor => {
        const impact = factor.impact === 'positive' ? '正向证据' : factor.impact === 'negative' ? '限制因素' : '参考信息';
        lines.push(`- **${factor.label}**（${impact}）：${maskEvidenceValue(factor.detail)}`);
      });
      lines.push('');
    }

    if (card.actions.length > 0) {
      lines.push('### 可执行动作');
      card.actions.forEach((action, i) => {
        lines.push(`${i + 1}. **[${roleLabel(action.role)}] ${action.title}**`);
        lines.push(`   ${action.detail}`);
        if (action.command) {
          lines.push(`   \`\`\`bash`);
          lines.push(`   ${action.command}`);
          lines.push(`   \`\`\``);
        }
        if (action.expectedResult) {
          lines.push(`   预期结果：${action.expectedResult}`);
        }
      });
      lines.push('');
    }

    if (card.limitations && card.limitations.length > 0) {
      lines.push('### 限制说明');
      card.limitations.forEach(lim => {
        lines.push(`- ${lim}`);
      });
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    user: '用户',
    it: 'IT',
    backend: '后端',
    frontend: '前端',
  };
  return map[role] || role;
}
