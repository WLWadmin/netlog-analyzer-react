/**
 * 项目排障经验中的对照项。
 *
 * 这些值只用于低风险的对比测试，不能因为某个对照结果不同就直接判定根因。
 * 中国大陆场景优先使用国内公共解析器，是项目排障策略，不是对其他解析器
 * 当前维护状态或稳定性的事实判断。
 */
export const MAINLAND_CHINA_DNS_COMPARISON_SERVERS = [
  '223.5.5.5',
  '223.6.6.6',
  '119.29.29.29',
  '180.76.76.76',
] as const;

export const MAINLAND_CHINA_DNS_COMPARISON_LIST = MAINLAND_CHINA_DNS_COMPARISON_SERVERS.join('、');

export const MAINLAND_CHINA_DNS_NON_DEFAULT_SERVERS = [
  '8.8.8.8',
  '114.114.114.114',
] as const;

export const MAINLAND_CHINA_DNS_NON_DEFAULT_LIST = MAINLAND_CHINA_DNS_NON_DEFAULT_SERVERS.join('、');

/** 厂商名只用于提示排查范围，不代表产品已经确认了拦截方。 */
export const CONNECTION_RESET_SECURITY_EXAMPLES = '深信服等安全网关、火绒等终端安全软件';
