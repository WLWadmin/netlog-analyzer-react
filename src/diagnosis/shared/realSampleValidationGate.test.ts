import {
  buildRealSampleValidationGateReport,
  isCompleteRealSampleValidationGateReport,
} from './realSampleValidationGate';

describe('real sample validation gate', () => {
  it('reports missing matrix areas without exposing environment values', () => {
    const privatePath = '/private/sample/location';
    const report = buildRealSampleValidationGateReport({
      RUN_HAR_REAL_SAMPLES: '1',
      HAR_REAL_SAMPLE_DIR: privatePath,
      NETLOG_PARITY_SAMPLE_DIR: privatePath,
    });
    const serialized = JSON.stringify(report);

    expect(report).toMatchObject({
      passed: false,
      configuredAreaCount: 2,
      requiredAreaCount: 6,
    });
    expect(report.areas.find(area => area.area === 'trace')).toEqual({
      area: 'trace',
      configured: false,
      executed: false,
      passed: false,
      missingEnvironmentVariables: [
        'TRACE_SAMPLE_MANIFEST_PATH',
        'TRACE_PLAIN_SAMPLE_PATH',
        'TRACE_GZIP_SAMPLE_PATH',
      ],
    });
    expect(serialized).not.toContain(privatePath);
  });

  it('does not pass when every area is configured but has not executed', () => {
    const report = buildRealSampleValidationGateReport({
      RUN_HAR_REAL_SAMPLES: '1',
      HAR_REAL_SAMPLE_DIR: 'configured',
      NETLOG_PARITY_SAMPLE_DIR: 'configured',
      TRACE_SAMPLE_MANIFEST_PATH: 'configured',
      TRACE_PLAIN_SAMPLE_PATH: 'configured',
      TRACE_GZIP_SAMPLE_PATH: 'configured',
      DIAGNOSIS_COMBINED_SAMPLE_MANIFEST_PATH: 'configured',
      DIAGNOSIS_LARGE_FILE_SAMPLE_MANIFEST_PATH: 'configured',
      DIAGNOSIS_ACCEPTANCE_RECORD_PATH: 'configured',
    });

    expect(report.passed).toBe(false);
    expect(report.areas.every(area => area.configured)).toBe(true);
    expect(report.areas.every(area => !area.executed && !area.passed)).toBe(true);
  });

  it('passes only when every configured area executed successfully', () => {
    const environment = {
      RUN_HAR_REAL_SAMPLES: '1',
      HAR_REAL_SAMPLE_DIR: 'configured',
      NETLOG_PARITY_SAMPLE_DIR: 'configured',
      TRACE_SAMPLE_MANIFEST_PATH: 'configured',
      TRACE_PLAIN_SAMPLE_PATH: 'configured',
      TRACE_GZIP_SAMPLE_PATH: 'configured',
      DIAGNOSIS_COMBINED_SAMPLE_MANIFEST_PATH: 'configured',
      DIAGNOSIS_LARGE_FILE_SAMPLE_MANIFEST_PATH: 'configured',
      DIAGNOSIS_ACCEPTANCE_RECORD_PATH: 'configured',
    };
    const report = buildRealSampleValidationGateReport(environment, {
      har: { executed: true, passed: true },
      netlog: { executed: true, passed: true },
      trace: { executed: true, passed: true },
      combined: { executed: true, passed: true },
      'large-file': { executed: true, passed: true },
      acceptance: { executed: true, passed: true },
    });

    expect(report.passed).toBe(true);
    expect(report.areas.every(area => area.executed && area.passed)).toBe(true);
    expect(isCompleteRealSampleValidationGateReport(report)).toBe(true);
  });

  it('rejects a self-declared pass when the area matrix is incomplete', () => {
    expect(isCompleteRealSampleValidationGateReport({
      passed: true,
      configuredAreaCount: 1,
      executedAreaCount: 1,
      passedAreaCount: 1,
      requiredAreaCount: 1,
      areas: [{
        area: 'trace',
        configured: true,
        executed: true,
        passed: true,
        missingEnvironmentVariables: [],
      }],
    })).toBe(false);
  });

  it('does not pass an area whose validation executed and failed', () => {
    const report = buildRealSampleValidationGateReport({
      NETLOG_PARITY_SAMPLE_DIR: 'configured',
    }, {
      netlog: { executed: true, passed: false },
    });

    expect(report.areas.find(area => area.area === 'netlog')).toMatchObject({
      configured: true,
      executed: true,
      passed: false,
    });
    expect(report.passed).toBe(false);
  });

  it('does not accept the HAR directory unless execution is explicitly enabled', () => {
    const report = buildRealSampleValidationGateReport({
      RUN_HAR_REAL_SAMPLES: '0',
      HAR_REAL_SAMPLE_DIR: 'configured',
    });

    expect(report.areas.find(area => area.area === 'har')).toEqual({
      area: 'har',
      configured: false,
      executed: false,
      passed: false,
      missingEnvironmentVariables: ['RUN_HAR_REAL_SAMPLES'],
    });
  });
});
