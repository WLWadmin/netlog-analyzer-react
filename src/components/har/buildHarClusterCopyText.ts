import { formatHarTime } from '../../harParser';
import { getHarEvidenceLevelLabel, getHarRoleLabel, type HarIssueCluster } from '../../diagnosis/shared/harIssueClusters';

function sanitizeEvidenceText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/g, '<URL>')
    .replace(/(authorization|cookie|set-cookie|token|body)=?[^；\n\s]*/gi, '$1=<redacted>');
}

export function buildHarClusterCopyText(cluster: HarIssueCluster): string {
  const lines = [
    'HAR 问题摘要',
    `现象：${cluster.title}`,
    `证据等级：${getHarEvidenceLevelLabel(cluster.evidenceLevel)}`,
    `影响范围：${cluster.affectedRequestCount} 个请求，${cluster.affectedDomainCount} 个域名`,
    cluster.maxDurationMs ? `最大耗时：${formatHarTime(cluster.maxDurationMs)}` : '',
    `代表请求：${cluster.representativeRequestIds.map(id => `request #${id + 1}`).join('、') || '-'}`,
    `关键证据：${cluster.evidence.map(item => `${item.label}=${sanitizeEvidenceText(item.value)}`).join('；')}`,
    `建议先看：${cluster.roleHints.map(getHarRoleLabel).join(' / ')}`,
    `需要补证：${cluster.requiresNetLog ? '建议补充同次 NetLog' : '暂不强制补充 NetLog'}`,
    `证据边界：${cluster.requiresNetLog ? 'HAR 只能说明请求现象，不能确认底层网络栈根因。' : 'HAR 记录的是请求现象，不代表责任归属。'}`,
  ].filter(Boolean);
  return lines.join('\n');
}
