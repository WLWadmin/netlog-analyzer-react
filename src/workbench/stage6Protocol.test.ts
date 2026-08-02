import {
  WORKBENCH_SCHEMA_VERSION,
  type AdvancedAnalysisResultResponse,
  type QueryAdvancedAnalysisRequest,
  type WorkbenchProjectedPluginEventDto,
} from './protocol';
import {
  isWorkbenchRequest,
  isWorkbenchResponse,
} from './spike/protocolGuards';

const session = {
  sessionId: 'session-stage6',
  sessionRevision: 1,
};

describe('Stage 6 advanced analysis protocol', () => {
  it('accepts the six bounded capabilities and rejects extra request data', () => {
    const capabilities: QueryAdvancedAnalysisRequest['capability'][] = [
      'layout-shifts',
      'animation-composition',
      'memory-trend',
      'gpu-raster',
      'custom-query',
      'track-plugin',
    ];

    for (const capability of capabilities) {
      const request: QueryAdvancedAnalysisRequest = {
        type: 'query-advanced-analysis',
        schemaVersion: WORKBENCH_SCHEMA_VERSION,
        requestId: `advanced-${capability}`,
        ...session,
        capability,
        range: { startUs: 0, endUs: 1_000 },
      };
      expect(isWorkbenchRequest(request)).toBe(true);
      expect(isWorkbenchRequest({
        ...request,
        rawTrace: [],
      })).toBe(false);
    }
  });

  it('allows explicit unavailable and insufficient results without raw evidence', () => {
    const response: AdvancedAnalysisResultResponse = {
      type: 'advanced-analysis-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'advanced-layout-shifts',
      ...session,
      capability: 'layout-shifts',
      status: 'insufficient',
      evidenceIds: ['trace:event:1'],
      limitations: ['LayoutShift 事件缺少可验证的累计值。'],
      result: {
        kind: 'layout-shifts',
        clusters: [],
      },
    };

    expect(isWorkbenchResponse(response)).toBe(true);
    expect(isWorkbenchResponse({
      ...response,
      args: { data: { url: 'https://private.invalid/?token=secret' } },
    })).toBe(false);
  });

  it('limits plugin input to a redacted projected event DTO', () => {
    const projected: WorkbenchProjectedPluginEventDto = {
      eventId: 'trace:timeline:1',
      evidenceIds: ['trace:event:1'],
      trackId: 'rendering',
      category: 'rendering',
      name: 'Layout',
      startUs: 10,
      durationUs: 5,
      status: 'normal',
    };

    expect(Object.keys(projected).sort()).toEqual([
      'category',
      'durationUs',
      'eventId',
      'evidenceIds',
      'name',
      'startUs',
      'status',
      'trackId',
    ]);
  });
});
