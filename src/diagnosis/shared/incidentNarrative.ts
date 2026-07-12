import type { IncidentEpisode } from './incidentEpisode';

const CATEGORY_LABEL: Record<string, string> = {
  dns: 'DNS 解析失败',
  connect: '连接失败',
  tls: 'TLS/证书异常',
  proxy: '代理链路异常',
  'network-change': '网络切换',
  server: '服务端响应异常',
  performance: '性能异常',
  'browser-queue': '浏览器排队异常',
  unknown: '未知异常',
};

function timeText(ms: number): string {
  return `${Math.round(ms)}ms`;
}

export function buildIncidentNarrative(episode: IncidentEpisode): string {
  const label = CATEGORY_LABEL[episode.category] || `${episode.category} 异常`;
  if (!episode.timeComparable || episode.startMs === undefined || episode.endMs === undefined) {
    return `当前文件中有 ${episode.affectedRequestCount} 个请求记录${label}；由于时间基准不足，无法判断持续时间和是否已经恢复。`;
  }

  const base = `在 ${timeText(episode.startMs)} 至 ${timeText(episode.endMs)}，${episode.affectedDomainCount} 个域名出现${label}，影响 ${episode.affectedRequestCount} 个请求`;
  if (episode.state === 'recovered' && episode.recoveredAtMs !== undefined) {
    return `${base}；${timeText(episode.recoveredAtMs)} 后同域请求恢复成功。`;
  }
  if (episode.state === 'ongoing') {
    return `${base}；当前文件内未看到明确恢复证据。`;
  }
  return `${base}；恢复状态未知。`;
}
