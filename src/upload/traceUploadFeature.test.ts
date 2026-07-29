import {
  isSupportedUploadName,
  isTraceAnalysisEnabled,
  traceUploadHint,
  uploadAccept,
} from './traceUploadFeature';

describe('Trace upload feature flag', () => {
  afterEach(() => {
    delete process.env.REACT_APP_ENABLE_TRACE_ANALYSIS;
  });

  it('is disabled by default and keeps the existing upload surface', () => {
    expect(isTraceAnalysisEnabled()).toBe(false);
    expect(uploadAccept()).toBe('.json,.har,.log');
    expect(traceUploadHint('sample.json')).toBeUndefined();
    expect(isSupportedUploadName('sample.trace')).toBe(false);
  });

  it('enables Trace extensions and JSON content routing only for value 1', () => {
    process.env.REACT_APP_ENABLE_TRACE_ANALYSIS = '1';

    expect(isTraceAnalysisEnabled()).toBe(true);
    expect(uploadAccept()).toContain('.trace');
    expect(traceUploadHint('sample.json')).toBe('json-auto');
    expect(traceUploadHint('sample.trace.gz')).toBe('trace');
    expect(isSupportedUploadName('sample.json2.gz')).toBe(true);
  });
});
