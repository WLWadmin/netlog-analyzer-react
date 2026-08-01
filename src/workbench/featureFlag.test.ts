import { isTraceWorkbenchEnabled } from './featureFlag';

describe('Trace Workbench feature flag', () => {
  afterEach(() => {
    delete process.env.REACT_APP_ENABLE_TRACE_WORKBENCH;
  });

  it('is disabled by default and only accepts the explicit compile-time value', () => {
    expect(isTraceWorkbenchEnabled()).toBe(false);
    process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '0';
    expect(isTraceWorkbenchEnabled()).toBe(false);
    process.env.REACT_APP_ENABLE_TRACE_WORKBENCH = '1';
    expect(isTraceWorkbenchEnabled()).toBe(true);
  });
});
