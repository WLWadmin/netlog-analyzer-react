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
];

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
  // 脱敏 URL
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return maskUrl(value);
  }
  // 脱敏可能包含 token 的值
  if (SENSITIVE_QUERY_PARAMS.some(p => value.toLowerCase().includes(p + '='))) {
    return value.replace(/(token|access_token|session_id|key|secret|password)=[^&\s]+/gi, (match) => {
      const eqIdx = match.indexOf('=');
      return match.substring(0, eqIdx + 1) + '***';
    });
  }
  return value;
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
    lines.push('');
    lines.push(`### 诊断结论`);
    lines.push(card.conclusion);
    lines.push('');

    if (card.evidence.length > 0) {
      lines.push('### 证据链');
      card.evidence.forEach(ev => {
        lines.push(`- **${ev.label}**：${maskEvidenceValue(ev.value)}`);
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
