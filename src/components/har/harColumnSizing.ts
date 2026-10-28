export interface HarColumnSize {
  key: string;
  minimum: number;
  preferred: number;
  flexible?: boolean;
}

// A resize exchanges width with one neighbour; it never grows the table budget.
export function fitHarColumnWidths(columns: HarColumnSize[], containerWidth: number): number[] {
  const minimumTotal = columns.reduce((sum, column) => sum + column.minimum, 0);
  const extra = Math.max(0, Math.floor(containerWidth) - minimumTotal);
  const preferredTotal = columns.reduce((sum, column) => sum + Math.max(column.minimum, column.preferred), 0);
  const flexibleCount = columns.filter(column => column.flexible).length;
  if (flexibleCount > 0) {
    const fixedTotal = columns.reduce((sum, column) => sum + (column.flexible ? column.minimum : Math.max(column.minimum, column.preferred)), 0);
    if (containerWidth >= fixedTotal) {
      const remaining = Math.floor(containerWidth) - fixedTotal;
      let flexibleIndex = 0;
      return columns.map(column => {
        if (!column.flexible) return Math.max(column.minimum, column.preferred);
        flexibleIndex++;
        return column.minimum + Math.floor(remaining / flexibleCount)
          + (flexibleIndex <= remaining % flexibleCount ? 1 : 0);
      });
    }
  }
  // Saved manual widths fit exactly until the container changes. On smaller
  // containers, preserve all minima before distributing remaining space.
  if (preferredTotal === Math.floor(containerWidth) && flexibleCount === 0) {
    return columns.map(column => Math.max(column.minimum, column.preferred));
  }
  const weights = columns.map(column => flexibleCount > 0 && column.flexible ? 0 : Math.max(0, column.preferred - column.minimum));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let used = 0;
  return columns.map((column, index) => {
    const share = index === columns.length - 1
      ? extra - used
      : Math.floor(extra * (weightTotal ? weights[index] / weightTotal : 1 / columns.length));
    used += share;
    return column.minimum + share;
  });
}
