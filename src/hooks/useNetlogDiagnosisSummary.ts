import { useEffect, useMemo, useState } from 'react';
import type { AnalysisResult, ParsedEvent } from '../parsers/netlog/parser';
import { generateSuggestions } from '../parsers/netlog/diagnosis';
import {
  buildFinalDiagnosisSummary,
  buildNetlogDiagnosisSummary,
  type DiagnosisSummary,
  type FinalDiagnosisSummary,
} from '../diagnosis/shared';

interface CachedNetlogDiagnosisSummary {
  eventsRef: ParsedEvent[];
  diagnosisSummary: DiagnosisSummary;
  finalSummary: FinalDiagnosisSummary;
}

export interface UseNetlogDiagnosisSummaryResult {
  loading: boolean;
  diagnosisSummary?: DiagnosisSummary;
  finalSummary?: FinalDiagnosisSummary;
}

const summaryCache = new WeakMap<AnalysisResult, CachedNetlogDiagnosisSummary>();

export function useNetlogDiagnosisSummary(
  result: AnalysisResult,
  events: ParsedEvent[]
): UseNetlogDiagnosisSummaryResult {
  const initialState = useMemo<UseNetlogDiagnosisSummaryResult>(() => {
    const cached = summaryCache.get(result);
    if (cached && cached.eventsRef === events) {
      return {
        loading: false,
        diagnosisSummary: cached.diagnosisSummary,
        finalSummary: cached.finalSummary,
      };
    }
    return { loading: true };
  }, [result, events]);

  const [state, setState] = useState<UseNetlogDiagnosisSummaryResult>(initialState);

  useEffect(() => {
    let cancelled = false;
    const cached = summaryCache.get(result);
    if (cached && cached.eventsRef === events) {
      setState({
        loading: false,
        diagnosisSummary: cached.diagnosisSummary,
        finalSummary: cached.finalSummary,
      });
      return;
    }

    setState({ loading: true });
    const timer = window.setTimeout(() => {
      const suggestions = generateSuggestions(result);
      const diagnosisSummary = buildNetlogDiagnosisSummary(result, suggestions, events);
      const finalSummary = buildFinalDiagnosisSummary(diagnosisSummary, 'netlog');

      summaryCache.set(result, {
        eventsRef: events,
        diagnosisSummary,
        finalSummary,
      });

      if (!cancelled) {
        setState({ loading: false, diagnosisSummary, finalSummary });
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [result, events]);

  return state;
}
