import type { TraceContextResult } from '../parsers/trace/types';
import { buildTraceDiagnosis } from '../diagnosis/trace/buildTraceDiagnosis';
import { buildTraceAnalysisResult } from './buildTraceAnalysisResult';

jest.mock('../diagnosis/trace/buildTraceDiagnosis', () => ({
  buildTraceDiagnosis: jest.fn(),
}));

const buildTraceDiagnosisMock = buildTraceDiagnosis as jest.MockedFunction<typeof buildTraceDiagnosis>;

describe('buildTraceAnalysisResult', () => {
  it('adds Worker-built diagnosis to the aggregated Trace result', () => {
    const aggregated: TraceContextResult = {
      intake: {
        format: 'chromium-trace-object',
        encoding: 'plain-json',
        jsonBytes: 20,
        eventCount: 1,
        availableFamilies: ['main-thread'],
        warnings: [],
      },
      context: {
        processes: [],
        threads: [],
        frames: [],
        navigations: [],
        evidence: [],
        evidenceTotalCount: 0,
        evidenceReturnedCount: 0,
        quality: {
          level: 'insufficient',
          captureWindow: 'missing',
          navigationContext: 'missing',
          processThreadMetadata: 'missing',
          frameHierarchy: 'missing',
          rendererMainThread: 'missing',
          skippedEventCount: 0,
          warnings: [],
          disabledCapabilities: [],
        },
        warnings: [],
      },
    };
    const diagnosis = {
      diagnoses: [],
      evaluations: [],
    };
    buildTraceDiagnosisMock.mockReturnValue(diagnosis);

    expect(buildTraceAnalysisResult(aggregated)).toEqual({
      ...aggregated,
      diagnosis,
    });
    expect(buildTraceDiagnosisMock).toHaveBeenCalledWith(aggregated.context);
  });
});
