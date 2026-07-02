import { buildFinalDiagnosisSummary } from './finalSummaryBuilder';
import type { DiagnosticCard, DiagnosisSummary } from './types';

function card(overrides: Partial<DiagnosticCard>): DiagnosticCard {
  return {
    id: overrides.id || 'card-1',
    source: overrides.source || 'netlog',
    category: overrides.category || 'dns',
    severity: overrides.severity || 'warning',
    confidence: overrides.confidence || 'medium',
    title: overrides.title || 'DNS 异常',
    conclusion: overrides.conclusion || '检测到 DNS 异常',
    scope: overrides.scope || { type: 'global', summary: '影响 3 个请求', affectedRequestCount: 3 },
    evidence: overrides.evidence || [{ label: '错误码', value: 'ERR_NAME_NOT_RESOLVED', source: 'netlog' }],
    actions: overrides.actions || [{ role: 'user', title: '切换网络验证', detail: '切换手机热点后重新复现' }],
    limitations: overrides.limitations,
    mergedSources: overrides.mergedSources,
    conflictNotes: overrides.conflictNotes,
    relatedRequestIds: overrides.relatedRequestIds,
    relatedEventIds: overrides.relatedEventIds,
    navigationTarget: overrides.navigationTarget,
    confidenceFactors: overrides.confidenceFactors,
  };
}

function summary(cards: DiagnosticCard[]): DiagnosisSummary {
  return {
    cards,
    overallSeverity: cards.some(c => c.severity === 'critical') ? 'critical' : 'warning',
    quality: {
      source: cards[0]?.source || 'netlog',
      isDiagnosable: true,
      issues: [],
    },
  };
}

describe('buildFinalDiagnosisSummary', () => {
  it('NetLog 高置信直接错误码输出已确认结论', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({ severity: 'critical', confidence: 'high', title: 'DNS 解析失败' }),
    ]), 'netlog');

    expect(result.status).toBe('has-conclusion');
    expect(result.headline[0].kind).toBe('confirmed');
    expect(result.headline[0].userFacingSummary).toContain('已确认');
  });

  it('HAR-only 不输出已确认网络根因', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({
        source: 'har',
        category: 'dns',
        confidence: 'high',
        title: 'DNS 阶段偏高',
        evidence: [{ label: 'DNS 耗时', value: '1200ms', source: 'har' }],
      }),
    ]), 'har');

    expect(result.headline[0].kind).toBe('symptom-only');
    expect(result.headline[0].userFacingSummary).toContain('仅现象');
    expect(result.missingInfo.some(item => item.id === 'har-needs-netlog')).toBe(true);
  });

  it('Combined 双源吻合时输出已确认结论', () => {
    const result = buildFinalDiagnosisSummary({
      ...summary([
        card({
          source: 'combined',
          confidence: 'high',
          mergedSources: ['har', 'netlog'],
          title: 'HAR 失败请求与 NetLog DNS 失败吻合',
          evidence: [
            { label: 'HAR 失败请求', value: 'api.example.com', source: 'har', originalSource: 'har' },
            { label: 'NetLog DNS 错误', value: 'ERR_NAME_NOT_RESOLVED', source: 'netlog', originalSource: 'netlog' },
          ],
        }),
      ]),
      combinedConfidence: 'high',
    }, 'combined');

    expect(result.headline[0].kind).toBe('confirmed');
  });

  it('Combined HAR TTFB 慢但无 NetLog 网络错误不能输出 confirmed', () => {
    const result = buildFinalDiagnosisSummary({
      ...summary([
        card({
          source: 'combined',
          category: 'performance',
          confidence: 'high',
          mergedSources: ['har', 'netlog'],
          title: '联合诊断：HAR TTFB 慢但 NetLog 未发现同域名网络错误',
          conclusion: 'HAR 请求主要慢在 TTFB，NetLog 未发现同域名 DNS/TLS/连接错误',
          evidence: [
            { label: 'HAR TTFB 慢请求', value: '3 个', source: 'har', originalSource: 'har' },
            { label: 'NetLog 对齐结果', value: '未发现同域名网络错误', source: 'netlog', originalSource: 'netlog' },
          ],
        }),
      ]),
      combinedConfidence: 'high',
    }, 'combined');

    expect(result.headline[0].kind).not.toBe('confirmed');
  });

  it('Combined HAR 慢但只有代理配置事实不能输出 confirmed', () => {
    const result = buildFinalDiagnosisSummary({
      ...summary([
        card({
          source: 'combined',
          category: 'proxy',
          confidence: 'high',
          mergedSources: ['har', 'netlog'],
          title: '联合诊断：HAR 慢请求与代理配置同时存在',
          conclusion: 'HAR 慢请求环境中检测到 PAC / 代理配置',
          evidence: [
            { label: 'HAR 慢请求', value: '5 个', source: 'har', originalSource: 'har' },
            { label: '代理模式', value: 'pac_script', source: 'netlog', originalSource: 'netlog' },
          ],
        }),
      ]),
      combinedConfidence: 'high',
    }, 'combined');

    expect(result.headline[0].kind).not.toBe('confirmed');
  });

  it('Combined HAR 慢但只有 DNS answer 候选不能输出 confirmed', () => {
    const result = buildFinalDiagnosisSummary({
      ...summary([
        card({
          source: 'combined',
          category: 'dns',
          confidence: 'high',
          mergedSources: ['har', 'netlog'],
          title: '联合诊断：HAR 慢请求与 DNS answer 候选同时存在',
          conclusion: 'HAR 慢请求环境中检测到 DNS answer 候选 IP',
          evidence: [
            { label: 'HAR 慢请求', value: '5 个', source: 'har', originalSource: 'har' },
            { label: 'DNS answer', value: 'example.com -> 203.0.113.10', source: 'netlog', originalSource: 'netlog' },
          ],
        }),
      ]),
      combinedConfidence: 'high',
    }, 'combined');

    expect(result.headline[0].kind).not.toBe('confirmed');
  });

  it('HTTP/2 覆盖率低不能输出 confirmed', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({
        id: 'http2-coverage',
        category: 'protocol',
        severity: 'warning',
        confidence: 'high',
        title: 'HTTP/2 覆盖率偏低',
        conclusion: '部分请求未使用 HTTP/2，可作为协议能力线索',
        evidence: [
          { label: 'HTTP/2 覆盖率', value: '38%', source: 'netlog' },
          { label: '协议统计', value: '仅统计结果，无错误码', source: 'derived' },
        ],
      }),
    ]), 'netlog');

    expect(result.headline[0].kind).not.toBe('confirmed');
  });

  it('QUIC/HTTP3 使用状态不能输出 confirmed', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({
        id: 'quic-usage',
        category: 'protocol',
        severity: 'info',
        confidence: 'high',
        title: '检测到 QUIC / HTTP3 使用',
        conclusion: '当前 NetLog 中存在 QUIC_SESSION 和 HTTP3 事件',
        evidence: [
          { label: 'QUIC 事件数量', value: '430', source: 'netlog' },
        ],
      }),
    ]), 'netlog');

    expect(result.headline[0].kind).not.toBe('confirmed');
  });

  it('仅检测到代理服务器配置不能输出 confirmed', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({
        id: 'proxy-config-only',
        category: 'proxy',
        severity: 'warning',
        confidence: 'high',
        title: '检测到代理服务器配置',
        conclusion: '当前环境存在 PAC / 代理配置',
        evidence: [
          { label: '代理模式', value: 'pac_script', source: 'netlog' },
          { label: '代理服务器', value: 'proxy.example.com:8080', source: 'netlog' },
        ],
      }),
    ]), 'netlog');

    expect(result.headline[0].kind).not.toBe('confirmed');
  });

  it('仅 DNS answer 为特殊 IP 不能输出 confirmed', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({
        id: 'dns-answer-special-ip',
        category: 'dns',
        severity: 'warning',
        confidence: 'high',
        title: 'DNS answer 指向特殊 IP',
        conclusion: 'DNS 解析结果包含 127.0.0.1',
        evidence: [
          { label: 'DNS answer', value: 'example.com -> 127.0.0.1', source: 'netlog' },
        ],
      }),
    ]), 'netlog');

    expect(result.headline[0].kind).not.toBe('confirmed');
  });

  it('按综合评分排序而不是只看严重程度', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({
        id: 'weak-critical',
        severity: 'critical',
        confidence: 'low',
        title: '严重但证据不足',
        evidence: [{ label: '线索', value: '仅派生提示', source: 'derived' }],
        actions: [],
        limitations: ['缺少直接证据'],
      }),
      card({
        id: 'strong-warning',
        severity: 'warning',
        confidence: 'high',
        title: '可操作 DNS 问题',
        evidence: [
          { label: '错误码', value: 'ERR_NAME_NOT_RESOLVED', source: 'netlog' },
          { label: '相关请求', value: '12 个请求', source: 'netlog', requestIds: [1, 2, 3] },
          { label: '影响域名', value: 'api.example.com', source: 'derived' },
        ],
        actions: [{ role: 'user', title: '更换 DNS 测试', detail: '更换 DNS 后重新访问' }],
        scope: { type: 'single-domain', summary: '影响 12 个请求', affectedRequestCount: 12, affectedDomainCount: 1 },
      }),
    ]), 'netlog');

    expect(result.headline[0].title).toBe('可操作 DNS 问题');
  });

  it('空卡片时回退为证据不足状态', () => {
    const result = buildFinalDiagnosisSummary({
      cards: [],
      overallSeverity: 'info',
      quality: {
        source: 'netlog',
        isDiagnosable: false,
        issues: [{ type: 'insufficient_data', severity: 'warning', message: '事件数量不足' }],
      },
    }, 'netlog');

    expect(result.status).toBe('insufficient-data');
    expect(result.missingInfo.length).toBeGreaterThan(0);
  });

  it('代理场景优先输出直连对比和代理白名单行动', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({
        id: 'proxy-card',
        category: 'proxy',
        severity: 'critical',
        confidence: 'high',
        title: '检测到代理服务器配置',
        conclusion: '当前配置了代理，请求返回 net_error: -2',
        evidence: [
          { label: '代理模式', value: 'pac_script', source: 'netlog' },
          { label: '问题域名', value: 'api.example.com', source: 'netlog' },
          { label: '错误码', value: '-2', source: 'netlog' },
        ],
        actions: [{ role: 'it', title: '核验 PAC 与代理服务器', detail: '检查 PAC 返回结果、代理服务器健康状态、认证策略和目标域名分流规则' }],
      }),
    ]), 'netlog');

    const userGroup = result.actionPlan.find(group => group.role === 'user');
    const itGroup = result.actionPlan.find(group => group.role === 'it');
    expect(userGroup?.actions.some(action => action.title === '做代理/直连对比')).toBe(true);
    expect(itGroup?.actions.some(action => action.title === '检查 PAC、代理服务器和域名白名单')).toBe(true);
    expect(userGroup?.actions.some(action => action.title === '先做直连对比')).toBe(false);
  });

  it('未检测到代理时不输出直连对比行动', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({
        id: 'proxy-negative-card',
        category: 'proxy',
        severity: 'info',
        confidence: 'low',
        title: '未包含代理事件',
        conclusion: '当前 NetLog 未检测到代理配置，也未包含代理相关事件',
        evidence: [
          { label: '代理模式', value: '未识别', source: 'netlog' },
          { label: '代理事件', value: '0 条', source: 'netlog' },
        ],
        actions: [{ role: 'user', title: '继续查看其他线索', detail: '当前没有代理证据，优先查看 DNS、连接或 TLS 结论' }],
      }),
    ]), 'netlog');

    const userActions = result.actionPlan.find(group => group.role === 'user')?.actions || [];
    expect(userActions.some(action => action.title === '做代理/直连对比')).toBe(false);
  });

  it('根据 NetLog 错误码生成 DNS、网络稳定性和安全软件排查行动', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({
        id: 'multi-error-card',
        category: 'connect',
        severity: 'critical',
        confidence: 'high',
        title: '多个网络错误',
        conclusion: '请求失败，错误码包括 -105、-101、-173',
        evidence: [
          { label: '错误码', value: '-105', source: 'netlog' },
          { label: '错误码', value: '-101', source: 'netlog' },
          { label: '错误码', value: '-173', source: 'netlog' },
          { label: '问题域名', value: 'api.example.com', source: 'netlog' },
        ],
        actions: [
          { role: 'user', title: '重新采集 HAR + NetLog', detail: '重新采集文件用于诊断' },
        ],
      }),
    ]), 'netlog');

    const userActions = result.actionPlan.find(group => group.role === 'user')?.actions || [];
    expect(userActions.some(action => action.title === '检查 DNS 配置和解析结果')).toBe(true);
    expect(userActions.some(action => action.title === '切换网络验证连接是否被当前网络重置')).toBe(true);
    expect(userActions.some(action => action.title === '检查安全软件或防火墙是否拦截')).toBe(true);
    expect(userActions.some(action => action.title === '确认 WebSocket / 协议升级链路')).toBe(true);
    expect(userActions.some(action => action.title.includes('重新采集'))).toBe(false);
    expect(userActions.findIndex(action => action.title === '确认 WebSocket / 协议升级链路'))
      .toBeGreaterThan(userActions.findIndex(action => action.title === '检查 DNS 配置和解析结果'));
    expect(userActions.findIndex(action => action.title === '确认 WebSocket / 协议升级链路'))
      .toBeGreaterThan(userActions.findIndex(action => action.title === '切换网络验证连接是否被当前网络重置'));
  });

  it('明确代理诊断时前三个用户操作是代理对比、安全拦截、网络稳定性', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({
        id: 'proxy-primary-card',
        category: 'proxy',
        severity: 'critical',
        confidence: 'high',
        title: '检测到代理导致请求失败',
        conclusion: '当前配置了代理，代理决策链路失败',
        evidence: [
          { label: '代理模式', value: 'pac_script', source: 'netlog' },
          { label: 'PAC 地址', value: 'https://proxy.example.com/proxy.pac', source: 'netlog' },
          { label: '错误码', value: '-100', source: 'netlog' },
          { label: '错误码', value: '-173', source: 'netlog' },
          { label: '问题域名', value: 'pcnfy7i3x66l.feishu.cn', source: 'netlog' },
          { label: '问题域名', value: 'open.feishu.cn', source: 'netlog' },
          { label: '问题域名', value: 'lf-package-cn.feishucdn.com', source: 'netlog' },
        ],
        actions: [],
      }),
    ]), 'netlog');

    const userActions = result.actionPlan.find(group => group.role === 'user')?.actions || [];
    expect(userActions[0]?.title).toBe('做代理/直连对比');
    expect(userActions[1]?.title).toBe('检查防火墙或安全软件拦截');
    expect(userActions[2]?.title).toBe('验证网络连接是否稳定');
    expect(userActions[2]?.detail).toContain('-100');
    expect(userActions[2]?.detail).toContain('-173');
    expect(userActions[2]?.detail.indexOf('-100')).toBeLessThan(userActions[2]?.detail.indexOf('-173'));
    expect(userActions[2]?.detail).toContain('*.feishu.cn（pcnfy7i3x66l.feishu.cn）');
    expect(userActions[2]?.detail).toContain('*.feishucdn.com');
    expect(userActions[2]?.detail).not.toContain('*.feishucdn.com（lf-package-cn.feishucdn.com）');
    expect(userActions[2]?.detail).not.toContain('open.feishu.cn');
  });

  it('缺失信息包含常规网络排查信息收集项', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({
        id: 'info-collection-card',
        category: 'connect',
        severity: 'warning',
        confidence: 'medium',
        title: '网络连接异常',
        conclusion: '请求失败，错误码 -100',
        evidence: [{ label: '错误码', value: '-100', source: 'netlog' }],
        actions: [],
      }),
    ]), 'netlog');

    const commonInfo = result.missingInfo.find(item => item.id === 'common-network-info');
    expect(commonInfo?.recommendation).toContain('客户端 IP / DNS 出口');
    expect(commonInfo?.recommendation).toContain('DNS / IP 连通性 / 丢包率 / 路由信息');
    expect(commonInfo?.recommendation).toContain('上网方式和环境信息');
    expect(commonInfo?.detailGroups?.[0].items[0]).toContain('https://ip.skk.moe/');
    expect(commonInfo?.detailGroups?.[1].title).toBe('打不开或请求慢的 URL 如何获取');
    expect(commonInfo?.detailGroups?.[1].items.join(' ')).toContain('URL 的域名');
    expect(commonInfo?.detailGroups?.[2].items.join(' ')).toContain('nslookup [问题域名]');
    expect(commonInfo?.detailGroups?.[2].items.join(' ')).toContain('traceroute [问题域名]');
    expect(commonInfo?.detailGroups?.[2].items.join(' ')).toContain('[网络信息收集说明](https://bytedance.larkoffice.com/docx/FOmKdpdCfoIl4WxV8eqc37BOnO1)');
    expect(commonInfo?.detailGroups?.[3].title).toBe('Wireshark 抓包文件');
    expect(commonInfo?.detailGroups?.[3].items.join(' ')).toContain('.pcapng');
  });

  it('证书错误 -202 输出用户、IT 和服务端证书排查行动', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({
        id: 'cert-202-card',
        category: 'tls',
        severity: 'critical',
        confidence: 'high',
        title: '证书颁发机构不受信任',
        conclusion: '请求失败，错误码 -202',
        evidence: [
          { label: '错误码', value: '-202', source: 'netlog' },
          { label: '问题域名', value: 'api.example.com', source: 'netlog' },
        ],
        actions: [],
      }),
    ]), 'netlog');

    const userActions = result.actionPlan.find(group => group.role === 'user')?.actions || [];
    const itActions = result.actionPlan.find(group => group.role === 'it')?.actions || [];
    const backendActions = result.actionPlan.find(group => group.role === 'backend')?.actions || [];
    expect(userActions.some(action => action.title === '切换网络判断是否为企业证书替换')).toBe(true);
    expect(userActions.some(action => action.title === '查看证书颁发者和证书链')).toBe(true);
    expect(itActions.some(action => action.title === '检查 HTTPS 解密和企业根证书策略')).toBe(true);
    expect(backendActions.some(action => action.title === '核验服务端证书链和 CA 信任')).toBe(true);
  });

  it('DNS resolver 错误 -803 使用 DNS 分类兜底行动', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({
        id: 'dns-803-card',
        category: 'dns',
        severity: 'warning',
        confidence: 'high',
        title: 'DNS 查询超时',
        conclusion: '请求失败，错误码 -803',
        evidence: [
          { label: '错误码', value: '-803', source: 'netlog' },
          { label: '问题域名', value: 'api.example.com', source: 'netlog' },
        ],
        actions: [],
      }),
    ]), 'netlog');

    const userActions = result.actionPlan.find(group => group.role === 'user')?.actions || [];
    const itActions = result.actionPlan.find(group => group.role === 'it')?.actions || [];
    expect(userActions.some(action => action.title === '检查 DNS 解析链路')).toBe(true);
    expect(itActions.some(action => action.title === '检查 DNS 服务器和解析策略')).toBe(true);
  });

  it('HTTP2/QUIC 协议错误输出协议链路排查行动', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({
        id: 'protocol-card',
        category: 'protocol',
        severity: 'warning',
        confidence: 'high',
        title: '协议错误',
        conclusion: '请求失败，错误码 -352、-356',
        evidence: [
          { label: '错误码', value: '-352', source: 'netlog' },
          { label: '错误码', value: '-356', source: 'netlog' },
        ],
        actions: [],
      }),
    ]), 'netlog');

    const userActions = result.actionPlan.find(group => group.role === 'user')?.actions || [];
    const itActions = result.actionPlan.find(group => group.role === 'it')?.actions || [];
    expect(userActions.some(action => action.title === '对比 HTTP/2、QUIC 或 TLS 协议链路')).toBe(true);
    expect(itActions.some(action => action.title === '检查中间设备协议兼容性')).toBe(true);
  });

  it('阻止类错误 -138 输出安全策略排查行动', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({
        id: 'blocked-card',
        category: 'security',
        severity: 'critical',
        confidence: 'high',
        title: '网络访问被拒绝',
        conclusion: '请求失败，错误码 -138',
        evidence: [
          { label: '错误码', value: '-138', source: 'netlog' },
          { label: '问题域名', value: 'api.example.com', source: 'netlog' },
        ],
        actions: [],
      }),
    ]), 'netlog');

    const userActions = result.actionPlan.find(group => group.role === 'user')?.actions || [];
    const itActions = result.actionPlan.find(group => group.role === 'it')?.actions || [];
    expect(userActions.some(action => action.title === '检查浏览器插件、安全策略或本机拦截')).toBe(true);
    expect(itActions.some(action => action.title === '核对管理员访问控制策略')).toBe(true);
  });

  it('缓存类错误 -400 输出缓存排查行动', () => {
    const result = buildFinalDiagnosisSummary(summary([
      card({
        id: 'cache-card',
        category: 'cache',
        severity: 'warning',
        confidence: 'medium',
        title: '缓存未命中',
        conclusion: '请求失败，错误码 -400',
        evidence: [{ label: '错误码', value: '-400', source: 'netlog' }],
        actions: [],
      }),
    ]), 'netlog');

    const userActions = result.actionPlan.find(group => group.role === 'user')?.actions || [];
    const frontendActions = result.actionPlan.find(group => group.role === 'frontend')?.actions || [];
    expect(userActions.some(action => action.title === '清理浏览器缓存后重试')).toBe(true);
    expect(frontendActions.some(action => action.title === '检查缓存策略和资源更新')).toBe(true);
  });
});
