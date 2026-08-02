import {
  isTraceExpertAnalysisEnabled,
  isTraceTimelineEnabled,
  isTraceWorkbenchEnabled,
} from './featureFlag';

describe('Trace Workbench feature flag', () => {
  afterEach(() => {
    delete process.env.REACT_APP_ENABLE_TRACE_WORKBENCH;
    delete process.env.REACT_APP_ENABLE_TRACE_TIMELINE;
    delete process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS;
  });

  it('is disabled by default and only accepts the explicit compile-time value', () => {
    expect(isTraceWorkbenchEnabled()).toBe(false);
    process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '0';
    expect(isTraceWorkbenchEnabled()).toBe(false);
    process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '1';
    expect(isTraceWorkbenchEnabled()).toBe(true);
  });

  it('only enables the Timeline MVP when both compile-time flags are explicit', () => {
    process.env.REACT_APP_ENABLE_TRACE_TIMELINE = '1';
    expect(isTraceTimelineEnabled()).toBe(false);

    process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '1';
    expect(isTraceTimelineEnabled()).toBe(true);

    process.env.REACT_APP_ENABLE_TRACE_TIMELINE = '0';
    expect(isTraceTimelineEnabled()).toBe(false);
  });

  it('only enables expert analysis when all three compile-time flags are explicit', () => {
    process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '1';
    process.env.REACT_APP_ENABLE_TRACE_TIMELINE = '1';
    expect(isTraceExpertAnalysisEnabled()).toBe(false);

    process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS = '1';
    expect(isTraceExpertAnalysisEnabled()).toBe(true);

    process.env.REACT_APP_ENABLE_TRACE_TIMELINE = '0';
    expect(isTraceExpertAnalysisEnabled()).toBe(false);
  });
});
