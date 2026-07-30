import { buildTraceDiagnosis } from '../diagnosis/trace/buildTraceDiagnosis';
import type { TraceAnalysisResult } from '../diagnosis/trace/types';
import type { TraceContextResult } from '../parsers/trace/types';

export function buildTraceAnalysisResult(
  aggregated: TraceContextResult,
): TraceAnalysisResult {
  return {
    ...aggregated,
    diagnosis: buildTraceDiagnosis(aggregated.context),
  };
}
