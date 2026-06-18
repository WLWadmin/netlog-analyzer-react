import { useState, useEffect, useMemo, useCallback } from 'react';

interface UseLoadMoreOptions<T> {
  items: T[];
  initialCount?: number;
  step?: number;
  /** 额外的依赖项，变化时强制重置 visibleCount（如筛选条件） */
  resetDeps?: React.DependencyList;
}

interface UseLoadMoreResult<T> {
  visibleItems: T[];
  hasMore: boolean;
  loadMore: () => void;
  reset: () => void;
  totalCount: number;
  visibleCount: number;
  remainingCount: number;
}

export function useLoadMore<T>({ items, initialCount = 50, step = 50, resetDeps }: UseLoadMoreOptions<T>): UseLoadMoreResult<T> {
  const [visibleCount, setVisibleCount] = useState(initialCount);

  // 当 items.length 或 resetDeps 变化时重置
  useEffect(() => {
    setVisibleCount(initialCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCount, items.length, ...(resetDeps ?? [])]);

  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const hasMore = visibleCount < items.length;
  const remainingCount = Math.max(0, items.length - visibleCount);

  const loadMore = useCallback(() => {
    setVisibleCount(prev => Math.min(prev + step, items.length));
  }, [items.length, step]);

  const reset = useCallback(() => {
    setVisibleCount(initialCount);
  }, [initialCount]);

  return {
    visibleItems,
    hasMore,
    loadMore,
    reset,
    totalCount: items.length,
    visibleCount: visibleItems.length,
    remainingCount,
  };
}

export default useLoadMore;
