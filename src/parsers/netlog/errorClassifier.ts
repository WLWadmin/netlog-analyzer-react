import { getNetErrorDescription } from './constants';

export type NetErrorCategoryName = 'DNS' | '证书' | '代理' | '网络变更' | '阻止' | '协议' | '连接' | '客户端' | '应用层' | '缓存' | '其他';

export interface NetErrorCategory {
  catName: NetErrorCategoryName;
  icon: string;
  sortWeight: number;
}

const CATEGORY_META: Record<NetErrorCategoryName, NetErrorCategory> = {
  DNS: { catName: 'DNS', icon: '🌐', sortWeight: 1 },
  证书: { catName: '证书', icon: '🔒', sortWeight: 2 },
  代理: { catName: '代理', icon: '⚠️', sortWeight: 3 },
  网络变更: { catName: '网络变更', icon: '🔄', sortWeight: 4 },
  阻止: { catName: '阻止', icon: '🚫', sortWeight: 5 },
  协议: { catName: '协议', icon: '📡', sortWeight: 6 },
  连接: { catName: '连接', icon: '🔗', sortWeight: 7 },
  客户端: { catName: '客户端', icon: '💻', sortWeight: 8 },
  应用层: { catName: '应用层', icon: '⚙️', sortWeight: 8 },
  缓存: { catName: '缓存', icon: '📦', sortWeight: 9 },
  其他: { catName: '其他', icon: '❓', sortWeight: 99 },
};

const DNS_ERRORS = new Set([
  -105,
  -119,
  -137,
  -800, -801, -802, -803, -804, -805, -806,
  -808, -809, -810, -811, -814, -815, -816, -817, -818, -819, -820,
]);

const CERT_ERRORS = new Set([
  -110, -117, -135, -150, -151, -156, -164, -167, -184,
  -200, -201, -202, -203, -204, -205, -206, -207, -208, -210,
  -211, -212, -213, -214, -215, -217,
  -701, -702, -707, -708, -709, -712,
]);

const PROXY_ERRORS = new Set([
  -111, -115, -120, -121, -127, -130, -131, -136,
  -170, -186, -187, -188,
  -323, -327, -348, -364, -366, -367,
]);

const BLOCKED_ERRORS = new Set([
  -10, -20, -22, -27, -29, -30, -32, -33, -34, -35, -36,
  -138, -385, -384,
]);

const PROTOCOL_ERRORS = new Set([
  -37,
  -107, -113, -122, -123, -125, -126, -153, -159, -172,
  -180, -182, -183,
  -337, -347, -351, -352, -356, -358, -360, -361, -362, -363,
  -365, -372, -376, -381,
]);

const CONNECTION_ERRORS = new Set([
  -7, -15, -21,
  -100, -101, -102, -103, -104, -106, -108, -109,
  -118, -124, -133, -139, -147,
]);

function byName(name: NetErrorCategoryName): NetErrorCategory {
  return CATEGORY_META[name];
}

export function classifyNetError(code: string | number | null): NetErrorCategory {
  if (code === null) return byName('其他');

  const num = typeof code === 'number' ? code : Number(code);
  if (!Number.isNaN(num)) {
    if (DNS_ERRORS.has(num)) return byName('DNS');
    if (CERT_ERRORS.has(num) || (num >= -299 && num <= -200)) return byName('证书');
    if (PROXY_ERRORS.has(num)) return byName('代理');
    if (num === -21) return byName('网络变更');
    if (BLOCKED_ERRORS.has(num)) return byName('阻止');
    if (PROTOCOL_ERRORS.has(num)) return byName('协议');
    if (CONNECTION_ERRORS.has(num) || (num >= -199 && num <= -100)) return byName('连接');
    if (num >= -413 && num <= -400) return byName('缓存');
    if (num === -2) return byName('其他');
    if (num >= -99 && num <= -1) return byName('客户端');
  }

  const desc = getNetErrorDescription(code);
  if (desc.includes('DNS') || desc.includes('NAME_NOT_RESOLVED') || desc.includes('HOST_RESOLVER')) return byName('DNS');
  if (desc.includes('PROXY') || desc.includes('SOCKS') || desc.includes('PAC')) return byName('代理');
  if (desc.includes('CERT') || desc.includes('PKCS12') || desc.includes('PRIVATE_KEY') || desc.includes('证书')) return byName('证书');
  if (desc.includes('BLOCKED') || desc.includes('ACCESS_DENIED') || desc.includes('PERMISSION') || desc.includes('阻止')) return byName('阻止');
  if (desc.includes('QUIC') || desc.includes('HTTP2') || desc.includes('ALPN') || desc.includes('SSL') || desc.includes('TLS') || desc.includes('协议')) return byName('协议');
  if (desc.includes('TIMED_OUT') || desc.includes('超时')) return byName('连接');
  if (desc.includes('REFUSED') || desc.includes('拒绝')) return byName('连接');
  if (desc.includes('RESET') || desc.includes('重置')) return byName('连接');
  return byName('其他');
}

export function classifySslIssueCategory(code: string | number | null): 'cert' | 'timeout' | 'protocol' | 'connection' | 'other' {
  if (code === null) return 'other';
  const num = typeof code === 'number' ? code : Number(code);
  if (Number.isFinite(num)) {
    const netCategory = classifyNetError(num).catName;
    if (netCategory === '证书') return 'cert';
    if (num === -118 || num === -7) return 'timeout';
    if (netCategory === '协议') return 'protocol';
    if (netCategory === '连接' || netCategory === '代理' || netCategory === '网络变更' || netCategory === '阻止') return 'connection';
  }
  return 'other';
}
