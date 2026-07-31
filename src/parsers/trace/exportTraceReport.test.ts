import { findSensitiveDataLeaks } from '../../diagnosis/shared/maskedExport';
import type { TraceAnalysisResult, TraceDiagnosis } from '../../diagnosis/trace';
import { buildTraceJsonExport, buildTraceMarkdownReport } from './exportTraceReport';

function diagnosis(overrides: Partial<TraceDiagnosis> = {}): TraceDiagnosis {
  return {
    id: 'diagnosis-medium',
    ruleId: 'N1',
    category: 'network',
    severity: 'warning',
    score: 0.6,
    title: '请求耗时偏高',
    conclusion: '请求阶段耗时高于参考阈值。',
    confidence: 'high',
    evidenceIds: ['trace:event:2', 'trace:event:missing'],
    counterEvidence: ['请求最终成功。'],
    advice: ['检查服务端响应时间。'],
    factIds: ['request-1'],
    limitations: ['仅覆盖当前录制窗口。'],
    ...overrides,
  };
}

function result(): TraceAnalysisResult {
  return {
    intake: {
      format: 'chromium-trace-object',
      encoding: 'plain-json',
      jsonBytes: 2048,
      eventCount: 20,
      captureStartUs: 1000,
      captureEndUs: 9000,
      availableFamilies: ['rendering', 'network', 'main-thread'],
      warnings: [],
    },
    context: {
      processes: [],
      threads: [],
      frames: [],
      navigations: [],
      requests: [{
        id: 'request-1', requestId: 'request-id', navigationKey: 'nav-1', redirectIndex: 0,
        url: { origin: 'https://example.test', pathname: '/api/items' },
        method: 'GET', resourceType: 'Fetch', statusCode: 200, protocol: 'h2',
        fromCache: false, failed: false, result: 'success', resultConfidence: 'high',
        timing: { trace: { startUs: 2000, endUs: 3000, durationMs: 1 } },
        initiatorEvidenceIds: [], evidenceIds: ['trace:event:2'], limitations: [],
        dataEventCount: 1, encodedDataLength: 100,
      }],
      tasks: [{
        id: 'task-1', navigationKey: 'nav-1', processId: 1, threadId: 2,
        startUs: 2500, durationMs: 80, blockingContributionMs: 30, selfTimeMs: 60,
        categorySelfTimeMs: { script: 50, rendering: 10 }, selfTimeConfidence: 'exact',
        limitations: [], evidenceIds: ['trace:event:2'],
      }],
      milestones: [{
        id: 'milestone-1', navigationKey: 'nav-1', name: 'FCP', timestampUs: 1500,
        relativeUs: 500, candidate: false, evidenceIds: ['trace:event:1'],
      }],
      animationFrames: [{
        id: 'frame-1', navigationKey: 'nav-1', processId: 1, threadId: 2,
        startUs: 3000, durationMs: 20, dropped: false, budgetMs: 16.7,
        overBudget: true, evidenceIds: ['trace:event:2'],
      }],
      rendering: [{
        id: 'render-1', navigationKey: 'nav-1', name: 'Layout', processId: 1,
        threadId: 2, startUs: 3100, durationMs: 10, evidenceIds: ['trace:event:2'],
      }],
      forcedReflowClues: [{
        id: 'reflow-1', navigationKey: 'nav-1', startUs: 3150,
        confidence: 'explicit', taskId: 'task-1', evidenceIds: ['trace:event:2'],
      }],
      interactions: [{
        id: 'interaction-1', interactionId: 1, navigationKey: 'nav-1', startUs: 3200,
        inputDelayMs: 5, processingDurationMs: 20, presentationDelayMs: 10,
        totalLatencyMs: 35, taskIds: ['task-1', 'missing-task'],
        renderingEventIds: ['render-1', 'missing-render'], frameIds: ['frame-1', 'missing-frame'],
        evidenceIds: ['trace:event:2'],
      }],
      cpuHotspots: [{
        id: 'hotspot-1', processId: 1, threadId: 2, profileId: 'profile-1', nodeId: 7,
        functionName: 'renderPage', script: { origin: 'https://example.test', pathname: '/app.js' },
        lineNumber: 10, columnNumber: 2, sampleCount: 4, sampleTimeMs: 8,
        navigationKey: 'nav-1', taskIds: ['task-1', 'missing-task'], evidenceIds: ['trace:event:2'],
      }],
      factCounts: {
        requests: { total: 2, returned: 1, truncated: true },
        tasks: { total: 1, returned: 1, truncated: false },
        profiles: { total: 1, returned: 0, truncated: true },
        milestones: { total: 1, returned: 1, truncated: false },
        animationFrames: { total: 1, returned: 1, truncated: false },
        rendering: { total: 1, returned: 1, truncated: false },
        interactions: { total: 1, returned: 1, truncated: false },
        cpuHotspots: { total: 1, returned: 1, truncated: false },
        forcedReflowClues: { total: 1, returned: 1, truncated: false },
      },
      evidence: [
        { evidenceId: 'trace:event:3', eventIndex: 3, origin: 'raw', name: 'UnusedPrivateEvent' },
        { evidenceId: 'trace:event:2', eventIndex: 2, origin: 'raw', name: 'ResourceSendRequest', processId: 1, threadId: 2, timestampUs: 2000 },
        { evidenceId: 'trace:event:1', eventIndex: 1, origin: 'raw', name: 'firstContentfulPaint', timestampUs: 1500 },
      ],
      evidenceTotalCount: 5,
      evidenceReturnedCount: 3,
      quality: {
        level: 'partial', captureWindow: 'available', navigationContext: 'available',
        processThreadMetadata: 'available', frameHierarchy: 'available',
        rendererMainThread: 'available', skippedEventCount: 0,
        warnings: ['部分事实被截断。'], disabledCapabilities: ['CPU profile 原始节点不导出。'],
      },
      warnings: ['TRACE_FACTS_TRUNCATED'],
    },
    diagnosis: {
      diagnoses: [
        diagnosis(),
        diagnosis({ id: 'diagnosis-low', ruleId: 'L1', category: 'loading', severity: 'info', score: 0.2, title: '低优先级' }),
        diagnosis({ id: 'diagnosis-primary', ruleId: 'M1', category: 'main-thread', severity: 'critical', score: 0.9, title: '主线程阻塞' }),
      ],
      evaluations: [{ ruleId: 'N2', status: 'not-matched', reason: '不满足阈值。' }],
    },
  };
}

function addField(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true });
}

const MALICIOUS_VALUES = {
  query: 'LEAK_QUERY_VALUE',
  fragment: 'LEAK_FRAGMENT_VALUE',
  cookie: 'LEAK_COOKIE_VALUE',
  authorization: 'LEAK_AUTHORIZATION_VALUE',
  token: 'LEAK_TOKEN_VALUE',
  headers: 'LEAK_HEADERS_VALUE',
  requestBody: 'LEAK_REQUEST_BODY_VALUE',
  responseBody: 'LEAK_RESPONSE_BODY_VALUE',
  traceEvents: 'LEAK_TRACE_EVENTS_VALUE',
  args: 'LEAK_ARGS_VALUE',
  screenshot: 'LEAK_SCREENSHOT_VALUE',
  sourceMap: 'LEAK_SOURCE_MAP_VALUE',
  scriptSource: 'LEAK_SCRIPT_SOURCE_VALUE',
  resourceContent: 'LEAK_RESOURCE_CONTENT_VALUE',
  filePath: '/Users/private/LEAK_FULL_FILE_PATH_VALUE/app.js',
} as const;

function injectMaliciousFields(input: TraceAnalysisResult): void {
  const request = input.context.requests?.[0];
  const task = input.context.tasks?.[0];
  const hotspot = input.context.cpuHotspots?.[0];
  const rendering = input.context.rendering?.[0];
  const interaction = input.context.interactions?.[0];
  const evidence = input.context.evidence[0];
  const diagnosisItem = input.diagnosis.diagnoses[0];
  if (!request || !request.url || !task || !hotspot || !rendering || !interaction) {
    throw new Error('测试夹具缺少必要事实');
  }

  request.url.pathname = `/api/items?token=${MALICIOUS_VALUES.query}#${MALICIOUS_VALUES.fragment}`;
  addField(input.context, 'Cookie', MALICIOUS_VALUES.cookie);
  addField(input, 'Authorization', MALICIOUS_VALUES.authorization);
  addField(input, 'token', MALICIOUS_VALUES.token);
  addField(request, 'headers', MALICIOUS_VALUES.headers);
  addField(request, 'requestBody', MALICIOUS_VALUES.requestBody);
  addField(rendering, 'responseBody', MALICIOUS_VALUES.responseBody);
  addField(input, 'traceEvents', [MALICIOUS_VALUES.traceEvents]);
  addField(task, 'args', MALICIOUS_VALUES.args);
  addField(interaction, 'screenshot', MALICIOUS_VALUES.screenshot);
  addField(hotspot, 'sourceMap', MALICIOUS_VALUES.sourceMap);
  addField(hotspot, 'scriptSource', MALICIOUS_VALUES.scriptSource);
  addField(request, 'resourceContent', MALICIOUS_VALUES.resourceContent);
  addField(evidence, 'filePath', MALICIOUS_VALUES.filePath);
  addField(diagnosisItem, '__proto__', { polluted: 'LEAK_PROTO_VALUE' });
}

describe('Trace 报告导出', () => {
  it('公开严格顶层 DTO，并投影各类有限事实', () => {
    const payload = buildTraceJsonExport(result());

    expect(Object.keys(payload)).toEqual([
      'schemaVersion', 'intakeSummary', 'quality', 'primaryDiagnosis',
      'secondaryDiagnoses', 'milestones', 'boundedRequests', 'boundedTasks',
      'boundedRendering', 'boundedInteractions', 'referencedEvidence',
      'limitations', 'truncation',
    ]);
    expect(payload.primaryDiagnosis?.id).toBe('diagnosis-primary');
    expect(payload.secondaryDiagnoses.map(item => item.id)).toEqual([
      'diagnosis-medium', 'diagnosis-low',
    ]);
    expect(payload.boundedRequests[0].url).toEqual({
      origin: 'https://example.test', pathname: '/api/items',
    });
    expect(payload.boundedTasks.tasks.map(item => item.id)).toEqual(['task-1']);
    expect(payload.boundedTasks.cpuHotspots[0].id).toBe('hotspot-1');
    expect(payload.boundedTasks.cpuHotspots[0].functionName).toBe('renderPage');
    expect(payload.boundedTasks.cpuHotspots[0].taskIds).toEqual(['task-1']);
    expect(payload.boundedRendering.frames.map(item => item.id)).toEqual(['frame-1']);
    expect(payload.boundedRendering.events.map(item => item.id)).toEqual(['render-1']);
    expect(payload.boundedRendering.reflow.map(item => item.id)).toEqual(['reflow-1']);
    expect(payload.boundedInteractions[0].taskIds).toEqual(['task-1']);
    expect(payload.boundedInteractions[0].renderingEventIds).toEqual(['render-1']);
    expect(payload.boundedInteractions[0].frameIds).toEqual(['frame-1']);
    expect(payload.truncation.facts.requests).toEqual({ total: 2, returned: 1, truncated: true });
  });

  it('无诊断时仍保留 primaryDiagnosis 顶层键', () => {
    const input = result();
    input.diagnosis.diagnoses = [];

    const payload = buildTraceJsonExport(input);

    expect(Object.prototype.hasOwnProperty.call(payload, 'primaryDiagnosis')).toBe(true);
    expect(payload.primaryDiagnosis).toBeNull();
    expect(payload.secondaryDiagnoses).toEqual([]);
  });

  it('观察项分数更高时仍与页面共用主诊断选择规则', () => {
    const input = result();
    input.diagnosis.diagnoses = [
      diagnosis({ id: 'network-observation', ruleId: 'N1', confidence: 'observation', score: 1 }),
      diagnosis({ id: 'main-thread', ruleId: 'M1', category: 'main-thread', confidence: 'medium', score: 0.5 }),
    ];

    const payload = buildTraceJsonExport(input);

    expect(payload.primaryDiagnosis?.id).toBe('main-thread');
    expect(payload.secondaryDiagnoses.map(item => item.id)).toEqual(['network-observation']);
  });

  it('只有观察项时不在导出报告中伪造主诊断', () => {
    const input = result();
    input.diagnosis.diagnoses = [
      diagnosis({ id: 'network-observation', ruleId: 'N1', confidence: 'observation' }),
      diagnosis({ id: 'security-observation', ruleId: 'S1', category: 'security', confidence: 'observation' }),
    ];

    const payload = buildTraceJsonExport(input);

    expect(payload.primaryDiagnosis).toBeNull();
    expect(payload.secondaryDiagnoses).toHaveLength(2);
  });

  it('仅导出已存在且被诊断或关键事实引用的证据，并稳定排序', () => {
    const payload = buildTraceJsonExport(result());

    expect(payload.referencedEvidence.map(item => item.evidenceId)).toEqual([
      'trace:event:1', 'trace:event:2',
    ]);
    expect(payload.primaryDiagnosis?.evidenceIds).toEqual(['trace:event:2']);
    expect(payload.referencedEvidence.some(item => item.evidenceId === 'trace:event:3')).toBe(false);
    expect(payload.referencedEvidence.some(item => item.evidenceId === 'trace:event:missing')).toBe(false);
  });

  it('导出 URL 会移除查询、片段和动态路径标识', () => {
    const input = result();
    const request = input.context.requests?.[0];
    if (!request?.url) throw new Error('测试夹具缺少 URL');
    request.url.pathname = '/users/123456789/account?token=secret#detail';

    expect(buildTraceJsonExport(input).boundedRequests[0].url).toEqual({
      origin: 'https://example.test',
      pathname: '/users/:id/account',
    });
  });

  it('诊断排序和导出内容不受输入顺序影响', () => {
    const first = result();
    const second = result();
    second.diagnosis.diagnoses.reverse();
    second.context.evidence.reverse();

    expect(buildTraceJsonExport(second)).toEqual(buildTraceJsonExport(first));
    expect(buildTraceMarkdownReport(second)).toBe(buildTraceMarkdownReport(first));
  });

  it('JSON 和 Markdown 逐项排除全部恶意字段与隐私值', () => {
    const input = result();
    injectMaliciousFields(input);

    const payload = buildTraceJsonExport(input);
    const json = JSON.stringify(payload);
    const markdown = buildTraceMarkdownReport(input);

    expect(payload.boundedRequests[0].url).toEqual({
      origin: 'https://example.test', pathname: '/api/items',
    });
    Object.values(MALICIOUS_VALUES).forEach(value => {
      expect(json).not.toContain(value);
      expect(markdown).not.toContain(value);
    });
    expect(json).not.toContain('__proto__');
    expect(markdown).not.toContain('__proto__');
    expect(findSensitiveDataLeaks(json)).toEqual([]);
    expect(findSensitiveDataLeaks(markdown)).toEqual([]);
  });

  it('Markdown 仅呈现白名单 DTO 中的诊断、事实计数和限制', () => {
    const input = result();
    injectMaliciousFields(input);
    const markdown = buildTraceMarkdownReport(input);

    expect(markdown).toContain('主线程阻塞');
    expect(markdown).toContain('CPU 热点：1');
    expect(markdown).toContain('强制回流线索：1');
    expect(markdown).toContain('request-1 | GET | https://example.test/api/items | success | 1 ms');
    expect(markdown).toContain('task-1 | 80 ms | blocking 30 ms | self 60 ms');
    expect(markdown).toContain('event render-1 | Layout | 10 ms');
    expect(markdown).toContain('interaction-1 | total 35 ms');
    expect(markdown).toContain('trace:event:2 | eventIndex 2 | ResourceSendRequest');
    expect(markdown).toContain('部分事实被截断。');
    expect(markdown).not.toContain('UnusedPrivateEvent');
    expect(findSensitiveDataLeaks(markdown)).toEqual([]);
  });
});
