export function isTraceWorkbenchEnabled(): boolean {
  return process.env.REACT_APP_ENABLE_TRACE_WORKBENCH === '1';
}

export function isTraceTimelineEnabled(): boolean {
  return isTraceWorkbenchEnabled()
    && process.env.REACT_APP_ENABLE_TRACE_TIMELINE === '1';
}

export function isTraceExpertAnalysisEnabled(): boolean {
  return isTraceTimelineEnabled()
    && process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS === '1';
}
