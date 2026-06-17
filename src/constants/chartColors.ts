export const CHART_COLORS = {
  primary: ['#4a9eff', '#22d3ee', '#34d399', '#a78bfa', '#fb923c', '#f87171', '#fbbf24'],
  colorblind: ['#0066cc', '#0099cc', '#66ccff', '#ff9933', '#ff6600', '#cc3300', '#999999'],
  semantic: { success: '#34d399', warning: '#fbbf24', error: '#f87171', info: '#4a9eff' },
  phases: { dns: '#a78bfa', connect: '#22d3ee', ssl: '#34d399', send: '#fbbf24', wait: '#4a9eff', download: '#fb923c' },
};

export function getChartColor(index: number): string {
  return CHART_COLORS.primary[index % CHART_COLORS.primary.length];
}
