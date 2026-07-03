import { createNetlogProxyStateReducer } from './netlogProxyStateReducer';

describe('createNetlogProxyStateReducer', () => {
  it('从 polledData/systemInfo 中提取代理配置、PAC 和 bypass 线索', () => {
    const reducer = createNetlogProxyStateReducer();

    reducer.acceptTopLevelConfig('polledData', 'polledData', {
      proxy: {
        mode: 'pac_script',
        pacUrl: 'https://proxy.example.com/proxy.pac',
        proxyServer: 'proxy.example.com:8080',
        bypassList: ['localhost', '*.internal.example.com'],
      },
    });
    reducer.acceptTopLevelConfig('systemInfo', 'systemInfo', {
      network: {
        proxySettings: {
          servers: ['socks5://127.0.0.1:1080'],
        },
      },
    });

    const view = reducer.finish();

    expect(view.hasProxyEvidence).toBe(true);
    expect(view.pacUrls).toContain('https://proxy.example.com/proxy.pac');
    expect(view.proxyServers).toEqual(expect.arrayContaining(['proxy.example.com:8080', 'socks5://127.0.0.1:1080']));
    expect(view.bypassRules).toEqual(expect.arrayContaining(['localhost', '*.internal.example.com']));
    expect(view.proxyConfigs).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'polledData.proxy.mode', value: 'pac_script', source: 'polledData' }),
    ]));
    expect(view.evidenceGaps).toEqual(expect.arrayContaining([
      '代理配置是环境事实，不能单独作为请求失败或慢请求根因。',
      '发现 PAC 线索，但未解析 PAC 规则命中结果；仍需结合代理事件或直连对比。',
    ]));
  });

  it('缺少代理配置时输出 evidence gap', () => {
    const reducer = createNetlogProxyStateReducer();

    reducer.acceptTopLevelConfig('polledData', 'polledData', {
      dnsConfig: { nameservers: ['8.8.8.8'] },
    });

    const view = reducer.finish();

    expect(view.hasProxyEvidence).toBe(false);
    expect(view.proxyConfigs).toEqual([]);
    expect(view.evidenceGaps).toContain('未发现代理配置快照；不代表当前环境没有代理，只表示 Dataset 未捕获相关配置。');
  });

  it('从代理事件提取 trace、PAC、bad proxy 和 fallback 线索', () => {
    const reducer = createNetlogProxyStateReducer();

    reducer.accept({
      eventId: 1,
      byteStart: 100,
      byteEnd: 199,
      time: 10,
      typeName: 'PROXY_RESOLUTION_SERVICE_RESOLVED_PROXY_LIST',
      sourceId: 200,
      sourceTypeName: 'PROXY_RESOLUTION_SERVICE',
      phase: 2,
      params: {
        pac_url: 'https://proxy.example.com/proxy.pac',
        proxy_server: 'PROXY proxy.example.com:8080',
      },
    });
    reducer.accept({
      eventId: 2,
      byteStart: 200,
      byteEnd: 299,
      time: 20,
      typeName: 'BAD_PROXY_LIST_REPORTED',
      sourceId: 201,
      sourceTypeName: 'PROXY_RESOLUTION_SERVICE',
      phase: 2,
      params: {
        bad_proxy: 'PROXY bad.example.com:8080',
        error: -130,
      },
    });

    const view = reducer.finish();

    expect(view.pacUrls).toContain('https://proxy.example.com/proxy.pac');
    expect(view.proxyServers).toEqual(expect.arrayContaining(['PROXY proxy.example.com:8080', 'PROXY bad.example.com:8080']));
    expect(view.proxyEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'decision',
        eventId: 1,
        sourceId: 200,
        byteStart: 100,
        byteEnd: 199,
        proxyServer: 'PROXY proxy.example.com:8080',
      }),
      expect.objectContaining({
        kind: 'bad-proxy',
        eventId: 2,
        sourceId: 201,
        error: -130,
        proxyServer: 'PROXY bad.example.com:8080',
      }),
    ]));
    expect(view.requestScopedErrors).toEqual([]);
    expect(view.evidenceGaps).toContain('发现代理事件，但未发现可安全关联到 URL_REQUEST 的代理错误；不能推断具体请求失败原因。');
  });

  it('只有 URL_REQUEST source 上的代理错误才输出 request-scoped error', () => {
    const reducer = createNetlogProxyStateReducer();

    reducer.accept({
      eventId: 3,
      byteStart: 300,
      byteEnd: 399,
      time: 30,
      typeName: 'HTTP_STREAM_JOB_CONTROLLER_PROXY_SERVER_RESOLVED',
      sourceId: 301,
      sourceTypeName: 'URL_REQUEST',
      phase: 2,
      params: {
        url: 'https://api.example.com/data',
        proxy_server: 'PROXY proxy.example.com:8080',
        net_error: -130,
      },
    });

    const view = reducer.finish();

    expect(view.requestScopedErrors).toEqual([
      expect.objectContaining({
        eventId: 3,
        sourceId: 301,
        byteStart: 300,
        byteEnd: 399,
        typeName: 'HTTP_STREAM_JOB_CONTROLLER_PROXY_SERVER_RESOLVED',
        url: 'https://api.example.com/data',
        proxyServer: 'PROXY proxy.example.com:8080',
        error: -130,
      }),
    ]);
    expect(view.evidenceGaps).not.toContain('发现代理事件，但未发现可安全关联到 URL_REQUEST 的代理错误；不能推断具体请求失败原因。');
  });
});
