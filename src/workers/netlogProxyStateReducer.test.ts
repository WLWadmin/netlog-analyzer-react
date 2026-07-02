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
});
