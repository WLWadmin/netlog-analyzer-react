import { buildAppHash, parseAppHash } from './hashRouting';

describe('hashRouting', () => {
  it('解析新版 NetLog hash 和专家二级 hash', () => {
    expect(parseAppHash('#netlog/conclusion')).toEqual({ fileType: 'netlog', tab: 'conclusion', subTab: undefined });
    expect(parseAppHash('#netlog/expert/events')).toEqual({ fileType: 'netlog', tab: 'expert', subTab: 'events' });
    expect(parseAppHash('#netlog/expert/source-chain')).toEqual({ fileType: 'netlog', tab: 'expert', subTab: 'source-chain' });
  });

  it('兼容旧版 NetLog hash', () => {
    expect(parseAppHash('#netlog/overview')).toEqual({ fileType: 'netlog', tab: 'conclusion' });
    expect(parseAppHash('#netlog/diagnosis')).toEqual({ fileType: 'netlog', tab: 'conclusion' });
    expect(parseAppHash('#netlog/combined')).toEqual({ fileType: 'netlog', tab: 'evidence' });
    expect(parseAppHash('#netlog/events')).toEqual({ fileType: 'netlog', tab: 'expert', subTab: 'events' });
    expect(parseAppHash('#netlog/source-chain')).toEqual({ fileType: 'netlog', tab: 'expert', subTab: 'source-chain' });
    expect(parseAppHash('#netlog/ssl-protocol')).toEqual({ fileType: 'netlog', tab: 'expert', subTab: 'security' });
    expect(parseAppHash('#netlog/performance')).toEqual({ fileType: 'netlog', tab: 'expert', subTab: 'performance' });
    expect(parseAppHash('#netlog/baseline')).toEqual({ fileType: 'netlog', tab: 'expert', subTab: 'baseline' });
    expect(parseAppHash('#netlog/raw-evidence')).toEqual({ fileType: 'netlog', tab: 'raw' });
  });

  it('兼容无 fileType 的旧版 NetLog hash', () => {
    expect(parseAppHash('#overview')).toEqual({ fileType: 'netlog', tab: 'conclusion' });
    expect(parseAppHash('#events')).toEqual({ fileType: 'netlog', tab: 'expert', subTab: 'events' });
  });

  it('解析 HAR 与 Log hash，并兼容 HAR diagnosis', () => {
    expect(parseAppHash('#har/requests')).toEqual({ fileType: 'har', tab: 'requests' });
    expect(parseAppHash('#har/diagnosis')).toEqual({ fileType: 'har', tab: 'summary' });
    expect(parseAppHash('#log/overview')).toEqual({ fileType: 'log', tab: 'overview' });
  });

  it('构造新版 hash', () => {
    expect(buildAppHash('netlog', 'expert', 'report')).toBe('#netlog/expert/report');
    expect(buildAppHash('har', 'summary')).toBe('#har/summary');
  });
});
