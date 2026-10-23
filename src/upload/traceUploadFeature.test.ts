import {
  isSupportedUploadName,
  isTraceAnalysisEnabled,
  uploadAccept,
} from './traceUploadFeature';

describe('Trace upload feature flag', () => {
  afterEach(() => {
    delete process.env.REACT_APP_ENABLE_TRACE_ANALYSIS;
  });

  it('enables Trace uploads by default', () => {
    delete process.env.REACT_APP_ENABLE_TRACE_ANALYSIS;
    expect(isTraceAnalysisEnabled()).toBe(true);
    expect(uploadAccept()).toContain('.trace');
    expect(isSupportedUploadName('sample.json.gz')).toBe(true);
  });

  it('supports explicitly disabling Trace and keeps the existing upload surface', () => {
    process.env.REACT_APP_ENABLE_TRACE_ANALYSIS = '0';
    expect(isTraceAnalysisEnabled()).toBe(false);
    expect(uploadAccept()).toBe('.json,.har,.log');
    expect(isSupportedUploadName('sample.trace')).toBe(false);
    expect(isSupportedUploadName('sample.json.gz')).toBe(false);
  });

  it('uses the flag only to advertise Trace analysis', () => {
    process.env.REACT_APP_ENABLE_TRACE_ANALYSIS = '1';

    expect(isTraceAnalysisEnabled()).toBe(true);
    expect(uploadAccept()).toContain('.trace');
    expect(isSupportedUploadName('sample.json2.gz')).toBe(true);
  });
});
