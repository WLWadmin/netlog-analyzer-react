import {
  useEffect,
  useState,
} from 'react';

export interface AnalysisRange {
  startUs: number;
  endUs: number;
}

const DEFAULT_STABILITY_DELAY_MS = 150;

export function useStableAnalysisRange(
  range: AnalysisRange,
  delayMs = DEFAULT_STABILITY_DELAY_MS,
): AnalysisRange | undefined {
  const [stableRange, setStableRange] = useState<AnalysisRange>();
  const rangeStartUs = range.startUs;
  const rangeEndUs = range.endUs;

  useEffect(() => {
    setStableRange(undefined);
    const timer = window.setTimeout(() => {
      setStableRange({ startUs: rangeStartUs, endUs: rangeEndUs });
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, rangeEndUs, rangeStartUs]);

  return stableRange;
}
