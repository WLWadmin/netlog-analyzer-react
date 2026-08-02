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

export function isTraceCrossSourceEnabled(): boolean {
  return isTraceExpertAnalysisEnabled()
    && process.env.REACT_APP_ENABLE_TRACE_CROSS_SOURCE === '1';
}

export function isTraceStage5Enabled(): boolean {
  return isTraceCrossSourceEnabled()
    && process.env.REACT_APP_ENABLE_TRACE_STAGE5 === '1';
}
