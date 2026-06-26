import type { IpScope } from './ipEvidenceTypes';

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  return parts.length === 4 && parts.every(part => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

function stripIpv6Zone(ip: string): string {
  const zoneIndex = ip.indexOf('%');
  return zoneIndex >= 0 ? ip.slice(0, zoneIndex) : ip;
}

export function normalizeIp(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value === '-') return null;

  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end > 0) return stripIpv6Zone(value.slice(1, end));
  }

  const ipv4WithPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (ipv4WithPort) {
    const ip = ipv4WithPort[1];
    return isValidIpv4(ip) ? ip : null;
  }

  if (value.includes(':') && !value.includes(' ')) {
    return stripIpv6Zone(value).toLowerCase();
  }

  return null;
}

export function classifyIpScope(ip: string): IpScope {
  if (isValidIpv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10) return 'private';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 127) return 'loopback';
    if (a === 169 && b === 254) return 'link-local';
    if (a === 0) return 'reserved';
    if (a >= 224 && a <= 239) return 'multicast';
    if (a >= 240) return 'reserved';
    return 'public';
  }

  const lower = stripIpv6Zone(ip).toLowerCase();
  if (lower === '::1') return 'loopback';
  if (lower.startsWith('fe80:')) return 'link-local';
  if (lower.startsWith('fc') || lower.startsWith('fd')) return 'private';
  if (lower === '::' || lower.startsWith('::ffff:0:') || lower.startsWith('2001:db8:')) return 'reserved';
  if (lower.includes(':')) return 'public';
  return 'invalid';
}
