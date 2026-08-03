const FORBIDDEN_STAGE6_KEYS = new Set([
  'args',
  'rawtrace',
  'rawevent',
  'authorization',
  'cookie',
  'token',
  'querytoken',
  'url',
  'fullurl',
  'screenshot',
  'screenshotbytes',
  'snapshot',
  'snapshotbytes',
  'code',
  'source',
  'script',
  'moduleurl',
  'networkurl',
]);

export function findForbiddenStage6Keys(
  value: unknown,
  matches = new Set<string>(),
): string[] {
  if (Array.isArray(value)) {
    value.forEach(item => findForbiddenStage6Keys(item, matches));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_STAGE6_KEYS.has(key.toLowerCase())) matches.add(key);
      findForbiddenStage6Keys(item, matches);
    }
  }
  return [...matches].sort();
}
