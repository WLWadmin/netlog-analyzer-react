import {
  isSupportedUploadName,
  isTraceAnalysisEnabled,
  uploadHintForFileName,
  uploadAccept,
} from './traceUploadFeature';

describe('Trace upload feature flag', () => {
  afterEach(() => {
    delete process.env.REACT_APP_ENABLE_TRACE_ANALYSIS;
  });

  it('is disabled by default and keeps the existing upload surface', () => {
    expect(isTraceAnalysisEnabled()).toBe(false);
    expect(uploadAccept()).toBe('.json,.har,.log');
    expect(uploadHintForFileName('sample.json')).toBe('json-auto');
    expect(uploadHintForFileName('sample.trace')).toBe('trace');
    expect(isSupportedUploadName('sample.trace')).toBe(true);
  });

  it('uses the flag only to advertise Trace analysis', () => {
    process.env.REACT_APP_ENABLE_TRACE_ANALYSIS = '1';

    expect(isTraceAnalysisEnabled()).toBe(true);
    expect(uploadAccept()).toContain('.trace');
    expect(uploadHintForFileName('sample.json')).toBe('json-auto');
    expect(uploadHintForFileName('sample.trace.gz')).toBe('trace');
    expect(isSupportedUploadName('sample.json2.gz')).toBe(true);
  });

  it.each([
    ['sample.log', 'log'],
    ['sample.har', 'har'],
    ['sample.json', 'json-auto'],
    ['sample.json.gz', 'json-auto'],
    ['sample.trace', 'trace'],
    ['sample.json2.gz', 'trace'],
    ['sample.zip', undefined],
  ])('returns a stable filename hint for %s', (fileName, expected) => {
    expect(uploadHintForFileName(fileName)).toBe(expected);
  });
});
