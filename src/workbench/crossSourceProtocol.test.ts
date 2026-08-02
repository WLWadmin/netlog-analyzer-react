import {
  isCrossSourceRequest,
  isCrossSourceResponse,
} from './crossSourceProtocolGuards';
import { WORKBENCH_SCHEMA_VERSION } from './protocol';

const session = {
  schemaVersion: WORKBENCH_SCHEMA_VERSION,
  requestId: 'request-1',
  sessionId: 'session-1',
  sessionRevision: 2,
};

describe('cross-source protocol guards', () => {
  it('accepts bounded source and graph queries', () => {
    expect(isCrossSourceRequest({
      ...session,
      type: 'add-source',
      sourceToken: 'prepared-1',
      expectedKind: 'har',
    })).toBe(true);
    expect(isCrossSourceRequest({
      ...session,
      type: 'query-evidence-graph',
      range: { startUs: 0, endUs: 100 },
      selectedEntityId: 'trace:request:1',
      limit: 100,
    })).toBe(true);
  });

  it('rejects raw or sensitive fields and unbounded limits', () => {
    expect(isCrossSourceRequest({
      ...session,
      type: 'add-source',
      sourceToken: 'prepared-1',
      expectedKind: 'har',
      file: new File(['{}'], 'private.har'),
    })).toBe(false);
    expect(isCrossSourceRequest({
      ...session,
      type: 'query-correlation',
      limit: 10_001,
      url: 'https://example.test/?token=<REDACTED>',
    })).toBe(false);
    expect(isCrossSourceRequest({
      ...session,
      type: 'query-evidence-graph',
      limit: 0,
    })).toBe(false);
  });

  it('rejects response DTOs containing raw URLs, headers or unknown fields', () => {
    const response = {
      ...session,
      type: 'sources-result',
      sourceRevision: 3,
      sources: [{
        sourceId: 'har:1',
        kind: 'har',
        parserId: 'har@1',
        label: 'HAR 来源',
        state: 'ready',
        byteLength: 100,
        clockDomain: {
          kind: 'har-epoch-ms',
          unit: 'ms',
          calibrated: false,
        },
        capabilities: ['requests'],
        limitations: [],
      }],
    };
    expect(isCrossSourceResponse(response)).toBe(true);
    expect(isCrossSourceResponse({
      ...response,
      sources: [{
        ...response.sources[0],
        url: 'https://example.test/?token=<REDACTED>',
      }],
    })).toBe(false);
    expect(isCrossSourceResponse({
      ...response,
      headers: { Authorization: '<REDACTED>' },
    })).toBe(false);
    expect(isCrossSourceResponse({
      ...response,
      sources: [{
        ...response.sources[0],
        parserId: 'chromium-netlog@1',
      }],
    })).toBe(false);
    expect(isCrossSourceResponse({
      ...session,
      type: 'evidence-graph-result',
      sourceRevision: 3,
      nodes: [{
        nodeId: 'node:1',
        kind: 'har-request',
        label: 'HAR 请求',
        evidenceIds: ['har:request:1'],
        limitations: [],
        args: { url: 'https://example.test/?token=<REDACTED>' },
      }],
      edges: [],
      limitations: [],
      truncation: { truncated: false, totalMatched: 1, returnedCount: 1 },
    })).toBe(false);
    expect(isCrossSourceResponse({
      ...session,
      type: 'correlation-result',
      sourceRevision: 3,
      candidates: [],
      entities: [{
        entityId: 'trace:request:1',
        sourceId: 'trace:1',
        kind: 'request',
        label: 'TRACE 请求',
        duration: { value: -1, unit: 'us' },
        evidenceIds: ['trace:event:1'],
        limitations: [],
      }],
      truncation: { truncated: false, totalMatched: 0, returnedCount: 0 },
    })).toBe(false);
  });
});
