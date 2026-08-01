export function isTraceWorkbenchEnabled(): boolean {
  return process.env.REACT_APP_ENABLE_TRACE_WORKBENCH === '1';
}
