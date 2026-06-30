import { exportReport } from './diagnosis';
import type { AnalysisResult, URLRequest } from './parser';

function request(overrides: Partial<URLRequest>): URLRequest {
  return {
    id: 1,
    url: 'https://api.example.com/data',
    method: 'GET',
    startTime: 0,
    endTime: 10,
    duration: 10,
    status: 'error',
    statusCode: 0,
    events: [],
    timeline: {},
    resolvedIp: null,
    remoteIp: null,
    ...overrides,
  };
}

function result(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    totalEvents: 10,
    uniqueSources: 2,
    peakConcurrency: 1,
    urlRequests: [],
    sslEvents: [],
    quicEvents: [],
    http2Events: [],
    dnsEvents: [],
    connectEvents: [],
    proxyEvents: [],
    errors: [],
    warnings: [],
    info: [],
    timeRange: { start: 0, end: 10 },
    protocols: {},
    hosts: {},
    dnsServers: [],
    dnsRecords: [],
    errorSources: {},
    certIssues: [],
    sslIssues: [],
    connectionFailures: [],
    stalledRequests: [],
    slowRequests: [],
    cacheEvents: [],
    networkChanges: [],
    proxyInfo: {
      hasProxy: false,
      proxyType: null,
      proxySettings: null,
      effectiveProxy: null,
      originalProxy: null,
      pacUrl: null,
      proxyList: [],
      proxyFallback: null,
      isVPN: false,
      vpnHints: [],
    },
    failedDomains: [],
    systemInfo: { os: null, browser: null, netLogVersion: null, commandLine: null },
    ...overrides,
  };
}

describe('exportReport', () => {
  it('导出报告顶部优先给小白用户原因和处理动作', () => {
    const report = exportReport(result({
      failedDomains: [{
        domain: 'api.example.com',
        urls: ['https://api.example.com/data'],
        errors: [{ code: -105, desc: 'ERR_NAME_NOT_RESOLVED', time: 1 }],
        errorCodes: [-105],
        ips: [],
        resolvedIp: null,
        remoteIp: null,
        count: 1,
        firstTime: 1,
        lastTime: 1,
      }],
      errorSources: { '-105': 1 },
    }));
    const firstLines = report.split('\n').slice(0, 20).join('\n');

    expect(firstLines).toContain('## 先看这里');
    expect(firstLines).toContain('可能原因');
    expect(firstLines).toContain('你现在该做什么');
  });

  it('不再导出冗长错误列表和警告列表', () => {
    const report = exportReport(result({
      errors: [{ severity: 'error', category: 'DNS', message: 'DNS 错误', detail: '这是非常长的底层错误详情'.repeat(20), time: 1 }],
      warnings: [{ severity: 'warning', category: '代理', message: '代理警告', detail: '这是非常长的警告详情'.repeat(20), time: 2 }],
    }));

    expect(report).not.toContain('## 错误列表');
    expect(report).not.toContain('## 警告列表');
    expect(report).not.toContain('这是非常长的底层错误详情');
    expect(report).not.toContain('这是非常长的警告详情');
  });

  it('受影响域名会去重并只输出域名', () => {
    const apiReq = request({ url: 'https://api.example.com/data?a=1', error: -105 });
    const duplicateApiReq = request({ id: 2, url: 'https://api.example.com/data?a=2', error: -118 });
    const cdnReq = request({ id: 3, url: 'https://cdn.example.com/static.js', duration: 5000, statusCode: 200 });
    const report = exportReport(result({
      urlRequests: [apiReq, duplicateApiReq, cdnReq],
      slowRequests: [cdnReq],
      connectionFailures: [
        { url: 'https://api.example.com/data?a=3', error: -105, time: 1 },
      ],
      failedDomains: [{
        domain: 'api.example.com',
        urls: ['https://api.example.com/data?a=4'],
        errors: [{ code: -105, desc: 'ERR_NAME_NOT_RESOLVED', time: 1 }],
        errorCodes: [-105],
        ips: [],
        resolvedIp: null,
        remoteIp: null,
        count: 3,
        firstTime: 1,
        lastTime: 3,
      }],
    }));

    expect((report.match(/api\.example\.com/g) || []).length).toBe(1);
    expect(report).toContain('- cdn.example.com');
    expect(report).not.toContain('data?a=');
  });

  it('检测到海外公共 DNS 时输出境内 DNS 建议', () => {
    const report = exportReport(result({
      dnsServers: ['8.8.8.8'],
      failedDomains: [{
        domain: 'api.example.com',
        urls: ['https://api.example.com/data'],
        errors: [{ code: -105, desc: 'ERR_NAME_NOT_RESOLVED', time: 1 }],
        errorCodes: [-105],
        ips: [],
        resolvedIp: null,
        remoteIp: null,
        count: 1,
        firstTime: 1,
        lastTime: 1,
      }],
      errorSources: { '-105': 1 },
    }));

    expect(report).toContain('阿里云 DNS：223.5.5.5 / 223.6.6.6');
    expect(report).toContain('百度 DNS：180.76.76.76');
    expect(report).toContain('腾讯云 DNSPod：119.29.29.29 / 182.254.116.116');
  });
});
