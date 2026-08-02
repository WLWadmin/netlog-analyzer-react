import {
  isTraceCrossSourceEnabled,
  isTraceExpertAnalysisEnabled,
  isTraceStage5Enabled,
  isTraceStage6Enabled,
  isTraceTimelineEnabled,
  isTraceWorkbenchEnabled,
} from './featureFlag';

describe('Trace Workbench feature flag', () => {
  afterEach(() => {
    delete process.env.REACT_APP_ENABLE_TRACE_WORKBENCH;
    delete process.env.REACT_APP_ENABLE_TRACE_TIMELINE;
    delete process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS;
    delete process.env.REACT_APP_ENABLE_TRACE_CROSS_SOURCE;
    delete process.env.REACT_APP_ENABLE_TRACE_STAGE5;
    delete process.env.REACT_APP_ENABLE_TRACE_STAGE6;
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

  it('only enables cross-source analysis when all four flags are explicit', () => {
    process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '1';
    process.env.REACT_APP_ENABLE_TRACE_TIMELINE = '1';
    process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS = '1';
    expect(isTraceCrossSourceEnabled()).toBe(false);

    process.env.REACT_APP_ENABLE_TRACE_CROSS_SOURCE = '1';
    expect(isTraceCrossSourceEnabled()).toBe(true);

    process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS = '0';
    expect(isTraceCrossSourceEnabled()).toBe(false);
  });

  it('only enables Stage 5 when all five flags are explicit', () => {
    process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '1';
    process.env.REACT_APP_ENABLE_TRACE_TIMELINE = '1';
    process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS = '1';
    process.env.REACT_APP_ENABLE_TRACE_CROSS_SOURCE = '1';
    expect(isTraceStage5Enabled()).toBe(false);

    process.env.REACT_APP_ENABLE_TRACE_STAGE5 = '1';
    expect(isTraceStage5Enabled()).toBe(true);

    process.env.REACT_APP_ENABLE_TRACE_CROSS_SOURCE = '0';
    expect(isTraceStage5Enabled()).toBe(false);
  });

  it('only enables Stage 6 when all six flags are explicit', () => {
    process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '1';
    process.env.REACT_APP_ENABLE_TRACE_TIMELINE = '1';
    process.env.REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS = '1';
    process.env.REACT_APP_ENABLE_TRACE_CROSS_SOURCE = '1';
    process.env.REACT_APP_ENABLE_TRACE_STAGE5 = '1';
    expect(isTraceStage6Enabled()).toBe(false);

    process.env.REACT_APP_ENABLE_TRACE_STAGE6 = '1';
    expect(isTraceStage6Enabled()).toBe(true);

    process.env.REACT_APP_ENABLE_TRACE_STAGE5 = '0';
    expect(isTraceStage6Enabled()).toBe(false);
  });
});
