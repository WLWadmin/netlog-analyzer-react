import type { HarRequestEntry } from '../../harParser';

export interface HarRedirectLink {
  fromRequestId: number;
  toRequestId: number;
  targetUrl: string;
  confidence: 'medium';
  basis: 'explicit-target-match';
}

function resolveRedirectTarget(entry: HarRequestEntry): string | undefined {
  const target = entry.redirect?.redirectURL || entry.redirect?.location;
  if (!target) return undefined;
  try {
    const resolved = new URL(target, entry.url);
    resolved.hash = '';
    return resolved.toString();
  } catch {
    return undefined;
  }
}

export function buildHarRedirectLinks(entries: HarRequestEntry[], windowMs = 5000): HarRedirectLink[] {
  const links: HarRedirectLink[] = [];
  const sorted = [...entries].sort((a, b) => a.startMs - b.startMs);

  for (const source of sorted) {
    const targetUrl = resolveRedirectTarget(source);
    if (!targetUrl || !Number.isFinite(source.startMs) || source.startMs <= 0) continue;

    const target = sorted.find(candidate => {
      if (candidate.id === source.id) return false;
      if (!Number.isFinite(candidate.startMs) || candidate.startMs < source.startMs) return false;
      if (candidate.startMs - source.startMs > windowMs) return false;
      try {
        const candidateUrl = new URL(candidate.url);
        candidateUrl.hash = '';
        return candidateUrl.toString() === targetUrl;
      } catch {
        return false;
      }
    });

    if (!target) continue;
    links.push({
      fromRequestId: source.id,
      toRequestId: target.id,
      targetUrl,
      confidence: 'medium',
      basis: 'explicit-target-match',
    });
  }

  return links;
}
