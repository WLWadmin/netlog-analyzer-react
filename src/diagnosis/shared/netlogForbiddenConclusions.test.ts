import {
  exportReport,
  generateChecklist,
  generateNextStepInfo,
  generateSuggestions,
} from '../../parsers/netlog/diagnosis';
import { assessProtocolHealth } from '../../components/netlog/ProtocolTab';
import type { AnalysisResult, URLRequest } from '../../parsers/netlog/parser';
import { buildFinalDiagnosisSummary } from './finalSummaryBuilder';
import { buildNetlogDiagnosisSummary } from './fromNetlog';
import { compareNetlogBaselines } from './netlogBaselineComparator';
import { buildNetlogExpertEvidencePackage } from './netlogExpertEvidenceExport';

jest.mock('antd', () => ({
  Card: () => null,
  Table: () => null,
  Tag: () => null,
}));
jest.mock('@ant-design/icons', () => ({
  ApiOutlined: () => null,
  SwapOutlined: () => null,
}));
jest.mock('recharts', () => ({
  Bar: () => null,
  BarChart: () => null,
  ResponsiveContainer: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const ERROR_CODES = [-2, -21, -101, -105, -107, -111, -337, -356];

function request(id: number, error: number): URLRequest {
  return {
    id,
    url: `https://host-${id}.example.com/path`,
    method: 'GET',
    startTime: id * 10,
    endTime: id * 10 + 5,
    duration: 5,
    status: 'error',
    statusCode: 0,
    error,
    events: [],
    timeline: {},
  };
}

function result(): AnalysisResult {
  const urlRequests = ERROR_CODES.map((code, index) => request(index + 1, code));
  return {
    totalEvents: 100,
    uniqueSources: urlRequests.length,
    peakConcurrency: 1,
    urlRequests,
    sslEvents: [],
    quicEvents: [],
    http2Events: [],
    dnsEvents: [],
    connectEvents: [],
    proxyEvents: [],
    errors: [],
    warnings: [],
    info: [],
    timeRange: { start: 0, end: 100 },
    protocols: {},
    hosts: {},
    dnsServers: ['8.8.8.8'],
    dnsRecords: [],
    errorSources: {},
    certIssues: [],
    sslIssues: [],
    connectionFailures: urlRequests.map(item => ({
      requestId: item.id,
      url: item.url,
      error: item.error as number,
      time: item.startTime,
    })),
    stalledRequests: [],
    slowRequests: [],
    cacheEvents: [],
    networkChanges: [],
    proxyInfo: {
      hasProxy: true,
      proxyType: 'pac_script',
      proxySettings: null,
      effectiveProxy: null,
      originalProxy: null,
      pacUrl: null,
      proxyList: ['PROXY proxy.example.com:8080'],
      proxyFallback: null,
      isVPN: false,
      vpnHints: [],
    },
    failedDomains: urlRequests.map(item => ({
      domain: new URL(item.url).hostname,
      urls: [item.url],
      errors: [{ code: item.error as number, desc: `net_error ${item.error}`, time: item.startTime }],
      errorCodes: [item.error as number],
      ips: [],
      resolvedIp: null,
      remoteIp: null,
      count: 1,
      firstTime: item.startTime,
      lastTime: item.startTime,
    })),
    systemInfo: { os: null, browser: null, netLogVersion: null, commandLine: null },
  };
}

describe('NetLog forbidden conclusions', () => {
  it('普通页、专家页、行动建议与导出不暴露无样本概率或责任方断言', () => {
    const analysis = result();
    analysis.http2Events = [{
      time: 1,
      type: 1,
      typeName: 'HTTP2_SESSION_SEND_GOAWAY',
      source: { id: 1, type: 1, typeName: 'HTTP2_SESSION' },
      phase: 0,
      phaseName: 'PHASE_NONE',
      params: { error_code: 1 },
    }];
    analysis.quicEvents = [{
      time: 2,
      type: 2,
      typeName: 'QUIC_SESSION_CLOSED',
      source: { id: 2, type: 2, typeName: 'QUIC_SESSION' },
      phase: 0,
      phaseName: 'PHASE_NONE',
      params: { net_error: -356 },
    }];
    const baseline = result();
    baseline.dnsServers = [];
    baseline.connectionFailures = [];
    baseline.failedDomains = [];
    baseline.proxyInfo = {
      ...baseline.proxyInfo,
      hasProxy: false,
      proxyType: null,
      proxyList: [],
    };
    const suggestions = generateSuggestions(analysis);
    const diagnosis = buildNetlogDiagnosisSummary(analysis, suggestions, []);
    const finalSummary = buildFinalDiagnosisSummary(diagnosis, 'netlog');
    const visibleOutput = JSON.stringify({
      suggestions,
      nextSteps: generateNextStepInfo(analysis),
      checklist: generateChecklist(analysis),
      finalSummary,
      markdown: exportReport(analysis),
      expertEvidence: buildNetlogExpertEvidencePackage({ result: analysis, datasetReady: false }),
      baselineComparison: compareNetlogBaselines(baseline, analysis),
      protocolHealth: assessProtocolHealth(analysis),
    });

    const forbidden = [
      /70%\s*以上/,
      /90%\s*以上/,
      /绝大部分/,
      /大概率/,
      /GFW/,
      /说明存在跨(?:网|境)问题/,
      /确认是否为代理导致/,
      /常见于安全软件/,
      /优先怀疑公司网关/,
      /深信服(?:导致|已拦截)/,
      /火绒(?:导致|已拦截)/,
    ];

    forbidden.forEach(pattern => expect(visibleOutput).not.toMatch(pattern));
  });

  it.each([
    [-2, '不能说明失败层级或责任方'],
    [-21, '只有与失败请求时间和 source chain 对齐'],
    [-101, '无法仅凭该错误判断重置来自'],
    [-105, '不能仅凭 -105 判断解析器故障或域名不存在'],
    [-107, '都是候选方向'],
    [-111, '还需区分代理连接、认证、CONNECT 响应'],
    [-337, '不能确定是客户端、服务端还是中间设备'],
    [-356, '都只是候选'],
  ])('错误码 %i 的用户结论保留证据边界', (errorCode, expectedBoundary) => {
    const analysis = result();
    analysis.connectionFailures = analysis.connectionFailures.filter(item => item.error === errorCode);
    const output = JSON.stringify(generateSuggestions(analysis));

    expect(output).toContain(expectedBoundary);
  });

  it('DNS 对照地址只进入操作建议，不进入诊断事实', () => {
    const analysis = result();
    analysis.connectionFailures = analysis.connectionFailures.filter(item => item.error === -105);
    const suggestion = generateSuggestions(analysis).find(item => item.errorCode === -105)!;
    const factText = `${suggestion.title} ${suggestion.detail} ${suggestion.conclusion}`;
    const actionText = suggestion.actions.join(' ');

    expect(actionText).toContain('223.5.5.5');
    expect(actionText).toContain('223.6.6.6');
    expect(actionText).toContain('119.29.29.29');
    expect(actionText).toContain('180.76.76.76');
    expect(actionText).toContain('测试完成后恢复原 DNS');
    expect(factText).not.toMatch(/223\.5\.5\.5|223\.6\.6\.6|119\.29\.29\.29|180\.76\.76\.76/);
  });

  it('安全软件厂商名只进入 -101 排查范围，不进入责任方结论', () => {
    const analysis = result();
    analysis.connectionFailures = analysis.connectionFailures.filter(item => item.error === -101);
    const suggestion = generateSuggestions(analysis).find(item => item.errorCode === -101)!;
    const factText = `${suggestion.title} ${suggestion.detail} ${suggestion.conclusion}`;
    const actionText = suggestion.actions.join(' ');

    expect(actionText).toContain('深信服');
    expect(actionText).toContain('火绒');
    expect(actionText).toContain('不把厂商名当作已确认责任方');
    expect(factText).not.toMatch(/深信服|火绒/);
  });
});
