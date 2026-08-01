import type { ChromiumTraceFile, TraceParserWarning } from './types';

export interface TraceAggregationProgress {
  phase: 'scan-events' | 'finalize-contexts' | 'build-facts';
  processed?: number;
  total?: number;
}

export interface TraceAggregationOptions {
  isCancelled: () => boolean;
  onProgress: (progress: TraceAggregationProgress) => void;
  yieldControl?: () => Promise<void>;
}

export interface TraceAggregatorOutput<TFacts> {
  facts: TFacts;
  warnings: TraceParserWarning[];
}

export interface TraceAggregatorPort<TFacts> {
  aggregate(
    trace: ChromiumTraceFile,
    options: TraceAggregationOptions,
  ): Promise<TraceAggregatorOutput<TFacts>>;
}
