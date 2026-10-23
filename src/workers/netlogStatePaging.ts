export interface NetlogStatePageQuery {
  pages: Record<string, number>;
}

export interface NetlogStatePaging {
  paging?: {
    totals: Record<string, number>;
    pages: Record<string, number>;
    kindCounts: Record<string, number>;
  };
}

export const NETLOG_STATE_PAGE_SIZE = 8;
const summaries = new WeakMap<object, { totals: Record<string, number>; kindCounts: Record<string, number> }>();

// Reducer snapshots are immutable after import. Cache counts without retaining
// released datasets, and copy only requested pages across the Worker boundary.
// Omitting the query retains the complete snapshot for explicit report export.
export function pageNetlogState<T extends object>(view: T, query?: NetlogStatePageQuery): T & NetlogStatePaging {
  if (!query) return view;
  const entries: Array<[string, unknown]> = Object.entries(view);
  let summary = summaries.get(view);
  if (!summary) {
    const totals: Record<string, number> = {};
    const kindCounts: Record<string, number> = {};
    for (const [key, value] of entries) {
      if (!Array.isArray(value) || key === 'evidenceGaps') continue;
      totals[key] = value.length;
      if (key === 'stateEvents') {
        const events: unknown[] = value;
        for (const row of events) {
          if (row && typeof row === 'object' && 'kind' in row && typeof row.kind === 'string') {
            kindCounts[row.kind] = (kindCounts[row.kind] ?? 0) + 1;
          }
        }
      }
    }
    summary = { totals, kindCounts };
    summaries.set(view, summary);
  }
  const rows: Record<string, unknown[]> = {};
  const pages: Record<string, number> = {};
  for (const [key, value] of entries) {
    if (!Array.isArray(value) || key === 'evidenceGaps') continue;
    const requested = query.pages[key] ?? 1;
    const last = Math.max(1, Math.ceil(value.length / NETLOG_STATE_PAGE_SIZE));
    const page = Number.isFinite(requested) ? Math.min(last, Math.max(1, Math.floor(requested))) : 1;
    pages[key] = page;
    rows[key] = value.slice((page - 1) * NETLOG_STATE_PAGE_SIZE, page * NETLOG_STATE_PAGE_SIZE);
  }
  // Each projected property is a slice of the same array, preserving its row type.
  return Object.assign({}, view, rows, { paging: { ...summary, pages } });
}

export function stateRowCount(view: NetlogStatePaging, key: string, fallback: number): number {
  return view.paging?.totals[key] ?? fallback;
}
