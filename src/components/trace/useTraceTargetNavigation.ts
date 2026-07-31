import { useEffect, useRef, useState } from 'react';
import { useNavigation } from '../../contexts/NavigationContext';
import type { TraceTab } from '../../utils/hashRouting';
import { traceEvidenceDomId, traceFactDomId } from './traceDiagnosisViewModel';

const HIGHLIGHT_DURATION_MS = 2000;

export function useTraceTargetNavigation(tab: TraceTab) {
  const { intent, consumeIntent } = useNavigation();
  const [highlightedDomId, setHighlightedDomId] = useState<string>();
  const [navigationError, setNavigationError] = useState<string>();
  const clearTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    if (clearTimerRef.current !== undefined) window.clearTimeout(clearTimerRef.current);
  }, []);

  useEffect(() => {
    if (intent?.fileType !== 'trace' || intent.tab !== tab || !intent.scrollTo) return;

    if (clearTimerRef.current !== undefined) window.clearTimeout(clearTimerRef.current);
    setHighlightedDomId(undefined);
    setNavigationError(undefined);

    const { type, id } = intent.scrollTo;
    const domId = type === 'evidence' ? traceEvidenceDomId(String(id)) : traceFactDomId(String(id));
    const target = document.getElementById(domId);
    if (target) {
      setHighlightedDomId(domId);
      const reduceMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      target.focus({ preventScroll: true });
      clearTimerRef.current = window.setTimeout(() => setHighlightedDomId(undefined), HIGHLIGHT_DURATION_MS);
    } else {
      const label = type === 'evidence' ? '证据' : '事实';
      setNavigationError(`未找到目标${label}：${id}`);
    }
    consumeIntent();
  }, [consumeIntent, intent, tab]);

  return { highlightedDomId, navigationError };
}
