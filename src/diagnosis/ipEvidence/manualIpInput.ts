export function parseManualIps(value: string): string[] {
  return Array.from(new Set(value.split(/[\s,，;；]+/).map(item => item.trim()).filter(Boolean)));
}
