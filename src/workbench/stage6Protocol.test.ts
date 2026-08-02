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
  it('accepts session descriptors that expose the GPU/Raster track', () => {
    expect(isWorkbenchResponse({
      type: 'session-created',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'session-stage6',
      ...session,
      session: {
        ...session,
        state: 'ready',
        source: {
          sourceId: 'trace-source',
          parserId: 'trace',
          fingerprint: 'trace:1:1',
        },
        capabilities: ['timeline-events', 'rendering'],
        missingCapabilities: [],
        range: { startUs: 0, endUs: 1_000 },
        eventCount: 1,
        trackEventCounts: { 'gpu-raster': 1 },
        screenshotCount: 0,
      },
    })).toBe(true);
  });

  it('accepts direct bounded analyses and rejects extra request data', () => {
    const capabilities: QueryAdvancedAnalysisRequest['capability'][] = [
      'layout-shifts',
      'animation-composition',
      'memory-trend',
      'gpu-raster',
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
    expect(isWorkbenchResponse({
      type: 'advanced-analysis-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'legacy-custom-query',
      ...session,
      capability: 'custom-query',
      status: 'unavailable',
      evidenceIds: [],
      limitations: [],
      result: {
        kind: 'custom-query',
        supportedFields: [],
        supportedOperators: [],
      },
    })).toBe(false);
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
      eventId: 'plugin:layout-watch:trace:timeline:1',
      sourceEventId: 'trace:timeline:1',
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
      'sourceEventId',
      'startUs',
      'status',
      'trackId',
    ]);
  });

  it('accepts bounded memory results and rejects raw or malformed fields', () => {
    const response: AdvancedAnalysisResultResponse = {
      type: 'advanced-analysis-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'advanced-memory',
      ...session,
      capability: 'memory-trend',
      status: 'available',
      evidenceIds: ['trace:event:1', 'trace:event:2'],
      limitations: ['不确认内存泄漏。'],
      result: {
        kind: 'memory-trend',
        samples: [{
          timestampUs: 10,
          metric: 'js-heap-used',
          bytes: 1_024,
          evidenceIds: ['trace:event:1'],
        }],
        gcEvents: [{
          eventId: 'trace:gc:2',
          type: 'minor',
          startUs: 20,
          durationUs: 5,
          interactionEventIds: [],
          longTaskEventIds: ['trace:timeline:3'],
          evidenceIds: ['trace:event:2'],
        }],
        summary: {
          gcCount: 1,
          totalPauseUs: 5,
          maxPauseUs: 5,
        },
      },
    };
    if (response.result.kind !== 'memory-trend') {
      throw new Error('unexpected memory result');
    }
    const memoryResult = response.result;

    expect(isWorkbenchResponse(response)).toBe(true);
    expect(isWorkbenchResponse({
      ...response,
      result: {
        ...memoryResult,
        rawEvents: [{ args: { data: { jsHeapSizeUsed: 1_024 } } }],
      },
    })).toBe(false);
    expect(isWorkbenchResponse({
      ...response,
      result: {
        ...memoryResult,
        gcEvents: Array.from({ length: 2 }, (_, index) => ({
          ...memoryResult.gcEvents[0],
          eventId: `trace:gc:${index}`,
          interactionEventIds: Array.from(
            { length: 1_001 },
            (__, contextIndex) => `trace:interaction:${index}:${contextIndex}`,
          ),
        })),
        summary: {
          gcCount: 2,
          totalPauseUs: 10,
          maxPauseUs: 5,
        },
      },
    })).toBe(false);
  });

  it('accepts bounded GPU/Raster summaries and rejects utilization claims', () => {
    const response: AdvancedAnalysisResultResponse = {
      type: 'advanced-analysis-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'advanced-gpu-raster',
      ...session,
      capability: 'gpu-raster',
      status: 'available',
      evidenceIds: ['trace:event:1'],
      limitations: ['只报告记录到的活动。'],
      result: {
        kind: 'gpu-raster',
        intervals: [{
          eventId: 'trace:gpu-raster:1',
          activity: 'raster',
          startUs: 10,
          durationUs: 5,
          evidenceIds: ['trace:event:1'],
        }],
        summary: {
          intervalCount: 1,
          gpuIntervalCount: 0,
          rasterIntervalCount: 1,
          totalDurationUs: 5,
          maxDurationUs: 5,
        },
      },
    };
    if (response.result.kind !== 'gpu-raster') {
      throw new Error('unexpected GPU/Raster result');
    }
    const gpuRasterResult = response.result;

    expect(isWorkbenchResponse(response)).toBe(true);
    expect(isWorkbenchResponse({
      ...response,
      result: { ...gpuRasterResult, gpuUtilization: 99 },
    })).toBe(false);
    expect(isWorkbenchResponse({
      ...response,
      result: {
        ...gpuRasterResult,
        summary: {
          ...gpuRasterResult.summary,
          intervalCount: 0,
        },
      },
    })).toBe(false);
  });

  it('accepts only valid declarative query clauses and rejects executable or raw fields', () => {
    const request = {
      type: 'query-custom-events',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'custom-query',
      ...session,
      range: { startUs: 0, endUs: 1_000 },
      query: {
        clauses: [
          { field: 'name', operator: 'contains', value: 'Layout' },
          { field: 'durationUs', operator: 'gte', value: 5 },
          { field: 'status', operator: 'equals', value: 'warning' },
        ],
      },
      limit: 200,
    };

    expect(isWorkbenchRequest(request)).toBe(true);
    expect(isWorkbenchRequest({
      ...request,
      query: {
        clauses: [{ field: 'status', operator: 'contains', value: 'warn' }],
      },
    })).toBe(false);
    expect(isWorkbenchRequest({
      ...request,
      query: {
        clauses: [{ field: 'durationUs', operator: 'gte', value: Infinity }],
      },
    })).toBe(false);
    expect(isWorkbenchRequest({
      ...request,
      continuation: 'not-a-timeline-event',
    })).toBe(false);
    for (const forbidden of ['rawTrace', 'args', 'code', 'url']) {
      expect(isWorkbenchRequest({ ...request, [forbidden]: {} })).toBe(false);
    }
  });

  it('accepts bounded custom query results without raw event data', () => {
    const response = {
      type: 'custom-query-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'custom-query',
      ...session,
      range: { startUs: 0, endUs: 1_000 },
      events: [{
        id: 'trace:timeline:1',
        trackId: 'rendering',
        startUs: 10,
        durationUs: 5,
        depth: 0,
        category: 'rendering',
        name: 'Layout',
        status: 'warning',
      }],
      evidenceIds: ['trace:event:1'],
      limitations: ['匹配数量不表示性能问题或根因。'],
      truncation: {
        truncated: false,
        returnedCount: 1,
        totalMatched: 1,
      },
    };

    expect(isWorkbenchResponse(response)).toBe(true);
    expect(isWorkbenchResponse({
      ...response,
      events: [{ ...response.events[0], args: { secret: true } }],
    })).toBe(false);
    expect(isWorkbenchResponse({
      ...response,
      evidenceIds: Array.from({ length: 2_001 }, (_, index) => `trace:event:${index}`),
    })).toBe(false);
  });

  it('accepts only declarative track plugin manifests', () => {
    const request = {
      type: 'install-track-plugin',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'install-plugin',
      ...session,
      range: { startUs: 0, endUs: 1_000 },
      manifest: {
        pluginId: 'layout-watch',
        label: 'Layout Watch',
        query: {
          clauses: [{ field: 'name', operator: 'equals', value: 'Layout' }],
        },
        maxEvents: 200,
      },
    };

    expect(isWorkbenchRequest(request)).toBe(true);
    for (const forbidden of [
      'code',
      'source',
      'script',
      'moduleUrl',
      'networkUrl',
      'args',
      'rawEvent',
    ]) {
      expect(isWorkbenchRequest({
        ...request,
        manifest: { ...request.manifest, [forbidden]: 'forbidden' },
      })).toBe(false);
    }
    expect(isWorkbenchRequest({
      ...request,
      manifest: { ...request.manifest, pluginId: 'Invalid_Plugin' },
    })).toBe(false);
    expect(isWorkbenchRequest({
      ...request,
      manifest: { ...request.manifest, maxEvents: 2_001 },
    })).toBe(false);
  });

  it('accepts bounded plugin projections and rejects raw or colliding shapes', () => {
    const response = {
      type: 'track-plugin-result',
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      requestId: 'install-plugin',
      ...session,
      operation: 'installed',
      plugin: {
        pluginId: 'layout-watch',
        label: 'Layout Watch',
        trackId: 'plugin:layout-watch',
      },
      range: { startUs: 0, endUs: 1_000 },
      projectedEvents: [{
        eventId: 'plugin:layout-watch:trace:timeline:1',
        sourceEventId: 'trace:timeline:1',
        evidenceIds: ['trace:event:1'],
        trackId: 'plugin:layout-watch',
        category: 'rendering',
        name: 'Layout',
        startUs: 10,
        durationUs: 5,
      }],
      evidenceIds: ['trace:event:1'],
      limitations: ['插件只能读取白名单投影。'],
      truncation: {
        truncated: false,
        returnedCount: 1,
        totalMatched: 1,
      },
    };

    expect(isWorkbenchResponse(response)).toBe(true);
    expect(isWorkbenchResponse({
      ...response,
      projectedEvents: [{
        ...response.projectedEvents[0],
        eventId: response.projectedEvents[0].sourceEventId,
      }],
    })).toBe(false);
    expect(isWorkbenchResponse({
      ...response,
      projectedEvents: [{
        ...response.projectedEvents[0],
        rawEvent: { args: { secret: true } },
      }],
    })).toBe(false);
    expect(isWorkbenchResponse({
      ...response,
      evidenceIds: Array.from(
        { length: 2_000 },
        (_, index) => `trace:event:${index}`,
      ),
    })).toBe(false);
  });
});
