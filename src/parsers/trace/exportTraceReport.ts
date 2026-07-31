import { findSensitiveDataLeaks, sanitizeDiagnosisText } from '../../diagnosis/shared/maskedExport';
import {
  selectTraceDiagnoses,
  type TraceAnalysisResult,
  type TraceDiagnosis,
} from '../../diagnosis/trace';
import type {
  TraceCollectionQuality,
  TraceEventRef,
  TraceFactCount,
  TraceFactCounts,
  TraceIntakeSummary,
  TraceSanitizedUrl,
} from './types';

export interface TraceExportDiagnosis {
  id: string;
  ruleId: TraceDiagnosis['ruleId'];
  category: TraceDiagnosis['category'];
  severity: TraceDiagnosis['severity'];
  score: number;
  title: string;
  conclusion: string;
  confidence: TraceDiagnosis['confidence'];
  evidenceIds: string[];
  counterEvidence: string[];
  advice: string[];
  factIds: string[];
  limitations: string[];
}

export interface TraceExportPayload {
  schemaVersion: 1;
  intakeSummary: TraceIntakeSummary;
  quality: TraceCollectionQuality;
  primaryDiagnosis: TraceExportDiagnosis | null;
  secondaryDiagnoses: TraceExportDiagnosis[];
  milestones: Array<{
    id: string;
    navigationKey: string;
    name: 'DCL' | 'Load' | 'FCP' | 'LCP';
    timestampUs: number;
    relativeUs: number;
    candidate: boolean;
    evidenceIds: string[];
  }>;
  boundedRequests: Array<{
    id: string;
    requestId: string;
    navigationKey?: string;
    redirectIndex: number;
    url?: TraceSanitizedUrl;
    method?: string;
    resourceType?: string;
    statusCode?: number;
    protocol?: string;
    fromCache?: boolean;
    failed?: boolean;
    result: string;
    resultConfidence: string;
    startUs: number;
    endUs?: number;
    durationMs?: number;
    evidenceIds: string[];
    limitations: string[];
  }>;
  boundedTasks: {
    tasks: Array<{
      id: string;
      navigationKey?: string;
      processId: number;
      threadId: number;
      startUs: number;
      durationMs: number;
      blockingContributionMs: number;
      selfTimeMs: number;
      categorySelfTimeMs: Partial<Record<'script' | 'rendering' | 'gc' | 'other', number>>;
      selfTimeConfidence: string;
      evidenceIds: string[];
      limitations: string[];
    }>;
    cpuHotspots: Array<{
      id: string;
      processId: number;
      threadId: number;
      profileId: string;
      nodeId: number;
      functionName: string;
      script?: TraceSanitizedUrl;
      lineNumber?: number;
      columnNumber?: number;
      sampleCount: number;
      sampleTimeMs: number;
      navigationKey?: string;
      taskIds: string[];
      evidenceIds: string[];
    }>;
  };
  boundedRendering: {
    frames: Array<{
      id: string;
      navigationKey?: string;
      processId: number;
      threadId: number;
      startUs: number;
      durationMs: number;
      dropped: boolean;
      budgetMs: number;
      overBudget: boolean;
      evidenceIds: string[];
    }>;
    events: Array<{
      id: string;
      navigationKey?: string;
      name: string;
      processId: number;
      threadId: number;
      startUs: number;
      durationMs: number;
      evidenceIds: string[];
    }>;
    reflow: Array<{
      id: string;
      navigationKey?: string;
      startUs: number;
      confidence: string;
      taskId?: string;
      evidenceIds: string[];
    }>;
  };
  boundedInteractions: Array<{
    id: string;
    interactionId: number;
    navigationKey?: string;
    startUs: number;
    inputDelayMs: number;
    processingDurationMs: number;
    presentationDelayMs: number;
    totalLatencyMs: number;
    taskIds: string[];
    renderingEventIds: string[];
    frameIds: string[];
    evidenceIds: string[];
  }>;
  referencedEvidence: TraceEventRef[];
  limitations: string[];
  truncation: {
    facts: TraceFactCounts;
    evidence: { total: number; returned: number; truncated: boolean };
  };
}

function clean(value: string): string {
  const sanitized = sanitizeDiagnosisText(value);
  return findSensitiveDataLeaks(sanitized).length === 0 ? sanitized : '[redacted]';
}

function cleanList(values: readonly string[]): string[] {
  return values.map(clean);
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function sortByStartAndId<T extends { startUs: number; id: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => left.startUs - right.startUs
    || left.id.localeCompare(right.id));
}

function availableEvidenceIds(result: TraceAnalysisResult): Set<string> {
  return new Set(result.context.evidence.map(item => item.evidenceId));
}

function validEvidenceIds(ids: readonly string[], available: Set<string>): string[] {
  return [...new Set(ids.filter(id => (
    /^trace:event:\d+$/.test(id) && available.has(id)
  )))].sort();
}

function maskPathSegment(segment: string): string {
  if (
    /^\d{6,}$/.test(segment)
    || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)
    || /^[0-9a-f]{16,}$/i.test(segment)
    || /^[A-Za-z0-9_-]{24,}$/.test(segment)
    || segment.includes('@')
  ) {
    return ':id';
  }
  return segment;
}

function projectUrl(url: TraceSanitizedUrl | undefined): TraceSanitizedUrl | undefined {
  if (!url) return undefined;
  let origin = url.origin;
  try {
    origin = new URL(url.origin).origin;
  } catch {
    origin = clean(url.origin);
  }
  const pathname = url.pathname
    .split(/[?#]/, 1)[0]
    .split('/')
    .map(segment => clean(maskPathSegment(segment)))
    .join('/');
  return { origin, pathname };
}

function projectDiagnosis(
  diagnosis: TraceDiagnosis,
  available: Set<string>,
): TraceExportDiagnosis {
  return {
    id: clean(diagnosis.id),
    ruleId: diagnosis.ruleId,
    category: diagnosis.category,
    severity: diagnosis.severity,
    score: diagnosis.score,
    title: clean(diagnosis.title),
    conclusion: clean(diagnosis.conclusion),
    confidence: diagnosis.confidence,
    evidenceIds: validEvidenceIds(diagnosis.evidenceIds, available),
    counterEvidence: cleanList(diagnosis.counterEvidence),
    advice: cleanList(diagnosis.advice),
    factIds: cleanList(diagnosis.factIds).sort(),
    limitations: cleanList(diagnosis.limitations).sort(),
  };
}

function factCount(value: TraceFactCount | undefined, returned: number): TraceFactCount {
  return value
    ? { total: value.total, returned: value.returned, truncated: value.truncated }
    : { total: returned, returned, truncated: false };
}

function projectFactCounts(result: TraceAnalysisResult): TraceFactCounts {
  const counts = result.context.factCounts;
  return {
    requests: factCount(counts?.requests, result.context.requests?.length ?? 0),
    tasks: factCount(counts?.tasks, result.context.tasks?.length ?? 0),
    profiles: factCount(counts?.profiles, result.context.profiles?.length ?? 0),
    milestones: factCount(counts?.milestones, result.context.milestones?.length ?? 0),
    animationFrames: factCount(counts?.animationFrames, result.context.animationFrames?.length ?? 0),
    rendering: factCount(counts?.rendering, result.context.rendering?.length ?? 0),
    interactions: factCount(counts?.interactions, result.context.interactions?.length ?? 0),
    cpuHotspots: factCount(counts?.cpuHotspots, result.context.cpuHotspots?.length ?? 0),
    forcedReflowClues: factCount(counts?.forcedReflowClues, result.context.forcedReflowClues?.length ?? 0),
  };
}

function projectIntake(intake: TraceIntakeSummary): TraceIntakeSummary {
  return {
    format: intake.format,
    encoding: intake.encoding,
    jsonBytes: intake.jsonBytes,
    eventCount: intake.eventCount,
    ...optional('captureStartUs', intake.captureStartUs),
    ...optional('captureEndUs', intake.captureEndUs),
    availableFamilies: [...intake.availableFamilies].sort(),
    warnings: [...intake.warnings].sort(),
  };
}

function projectQuality(quality: TraceCollectionQuality): TraceCollectionQuality {
  return {
    level: quality.level,
    captureWindow: quality.captureWindow,
    navigationContext: quality.navigationContext,
    processThreadMetadata: quality.processThreadMetadata,
    frameHierarchy: quality.frameHierarchy,
    rendererMainThread: quality.rendererMainThread,
    skippedEventCount: quality.skippedEventCount,
    warnings: cleanList(quality.warnings).sort(),
    disabledCapabilities: cleanList(quality.disabledCapabilities).sort(),
  };
}

export function buildTraceJsonExport(result: TraceAnalysisResult): TraceExportPayload {
  const available = availableEvidenceIds(result);
  const diagnosisSelection = selectTraceDiagnoses(result.diagnosis.diagnoses);
  const primaryDiagnosis = diagnosisSelection.primary
    ? projectDiagnosis(diagnosisSelection.primary, available)
    : null;
  const secondaryDiagnoses = diagnosisSelection.secondary
    .map(diagnosis => projectDiagnosis(diagnosis, available));
  const diagnoses = [
    ...(primaryDiagnosis ? [primaryDiagnosis] : []),
    ...secondaryDiagnoses,
  ];
  const milestones = [...(result.context.milestones ?? [])]
    .sort((left, right) => left.timestampUs - right.timestampUs || left.id.localeCompare(right.id))
    .map(item => ({
      id: clean(item.id),
      navigationKey: clean(item.navigationKey),
      name: item.name,
      timestampUs: item.timestampUs,
      relativeUs: item.relativeUs,
      candidate: item.candidate,
      evidenceIds: validEvidenceIds(item.evidenceIds, available),
    }));
  const boundedRequests = [...(result.context.requests ?? [])]
    .sort((left, right) => left.timing.trace.startUs - right.timing.trace.startUs
      || left.id.localeCompare(right.id))
    .map(item => ({
      id: clean(item.id),
      requestId: clean(item.requestId),
      ...optional('navigationKey', item.navigationKey === undefined ? undefined : clean(item.navigationKey)),
      redirectIndex: item.redirectIndex,
      ...optional('url', projectUrl(item.url)),
      ...optional('method', item.method === undefined ? undefined : clean(item.method)),
      ...optional('resourceType', item.resourceType === undefined ? undefined : clean(item.resourceType)),
      ...optional('statusCode', item.statusCode),
      ...optional('protocol', item.protocol === undefined ? undefined : clean(item.protocol)),
      ...optional('fromCache', item.fromCache),
      ...optional('failed', item.failed),
      result: item.result,
      resultConfidence: item.resultConfidence,
      startUs: item.timing.trace.startUs,
      ...optional('endUs', item.timing.trace.endUs),
      ...optional('durationMs', item.timing.trace.durationMs),
      evidenceIds: validEvidenceIds(item.evidenceIds, available),
      limitations: cleanList(item.limitations).sort(),
    }));
  const tasks = sortByStartAndId(result.context.tasks ?? []).map(item => ({
    id: clean(item.id),
    ...optional('navigationKey', item.navigationKey === undefined ? undefined : clean(item.navigationKey)),
    processId: item.processId,
    threadId: item.threadId,
    startUs: item.startUs,
    durationMs: item.durationMs,
    blockingContributionMs: item.blockingContributionMs,
    selfTimeMs: item.selfTimeMs,
    categorySelfTimeMs: {
      ...optional('script', item.categorySelfTimeMs.script),
      ...optional('rendering', item.categorySelfTimeMs.rendering),
      ...optional('gc', item.categorySelfTimeMs.gc),
      ...optional('other', item.categorySelfTimeMs.other),
    },
    selfTimeConfidence: item.selfTimeConfidence,
    evidenceIds: validEvidenceIds(item.evidenceIds, available),
    limitations: cleanList(item.limitations).sort(),
  }));
  const taskIds = new Set(tasks.map(item => item.id));
  const cpuHotspots = [...(result.context.cpuHotspots ?? [])]
    .sort((left, right) => right.sampleTimeMs - left.sampleTimeMs || left.id.localeCompare(right.id))
    .map(item => ({
      id: clean(item.id),
      processId: item.processId,
      threadId: item.threadId,
      profileId: clean(item.profileId),
      nodeId: item.nodeId,
      functionName: clean(item.functionName),
      ...optional('script', projectUrl(item.script)),
      ...optional('lineNumber', item.lineNumber),
      ...optional('columnNumber', item.columnNumber),
      sampleCount: item.sampleCount,
      sampleTimeMs: item.sampleTimeMs,
      ...optional('navigationKey', item.navigationKey === undefined ? undefined : clean(item.navigationKey)),
      taskIds: cleanList(item.taskIds).filter(id => taskIds.has(id)).sort(),
      evidenceIds: validEvidenceIds(item.evidenceIds, available),
    }));
  const frames = sortByStartAndId(result.context.animationFrames ?? []).map(item => ({
    id: clean(item.id),
    ...optional('navigationKey', item.navigationKey === undefined ? undefined : clean(item.navigationKey)),
    processId: item.processId,
    threadId: item.threadId,
    startUs: item.startUs,
    durationMs: item.durationMs,
    dropped: item.dropped,
    budgetMs: item.budgetMs,
    overBudget: item.overBudget,
    evidenceIds: validEvidenceIds(item.evidenceIds, available),
  }));
  const events = sortByStartAndId(result.context.rendering ?? []).map(item => ({
    id: clean(item.id),
    ...optional('navigationKey', item.navigationKey === undefined ? undefined : clean(item.navigationKey)),
    name: clean(item.name),
    processId: item.processId,
    threadId: item.threadId,
    startUs: item.startUs,
    durationMs: item.durationMs,
    evidenceIds: validEvidenceIds(item.evidenceIds, available),
  }));
  const reflow = sortByStartAndId(result.context.forcedReflowClues ?? []).map(item => ({
    id: clean(item.id),
    ...optional('navigationKey', item.navigationKey === undefined ? undefined : clean(item.navigationKey)),
    startUs: item.startUs,
    confidence: item.confidence,
    ...optional('taskId', item.taskId && taskIds.has(clean(item.taskId)) ? clean(item.taskId) : undefined),
    evidenceIds: validEvidenceIds(item.evidenceIds, available),
  }));
  const frameIds = new Set(frames.map(item => item.id));
  const eventIds = new Set(events.map(item => item.id));
  const boundedInteractions = sortByStartAndId(result.context.interactions ?? []).map(item => ({
    id: clean(item.id),
    interactionId: item.interactionId,
    ...optional('navigationKey', item.navigationKey === undefined ? undefined : clean(item.navigationKey)),
    startUs: item.startUs,
    inputDelayMs: item.inputDelayMs,
    processingDurationMs: item.processingDurationMs,
    presentationDelayMs: item.presentationDelayMs,
    totalLatencyMs: item.totalLatencyMs,
    taskIds: cleanList(item.taskIds).filter(id => taskIds.has(id)).sort(),
    renderingEventIds: cleanList(item.renderingEventIds).filter(id => eventIds.has(id)).sort(),
    frameIds: cleanList(item.frameIds).filter(id => frameIds.has(id)).sort(),
    evidenceIds: validEvidenceIds(item.evidenceIds, available),
  }));
  const exportedEvidenceIds = new Set([
    ...diagnoses.flatMap(item => item.evidenceIds),
    ...milestones.flatMap(item => item.evidenceIds),
    ...boundedRequests.flatMap(item => item.evidenceIds),
    ...tasks.flatMap(item => item.evidenceIds),
    ...cpuHotspots.flatMap(item => item.evidenceIds),
    ...frames.flatMap(item => item.evidenceIds),
    ...events.flatMap(item => item.evidenceIds),
    ...reflow.flatMap(item => item.evidenceIds),
    ...boundedInteractions.flatMap(item => item.evidenceIds),
  ]);
  const referencedEvidence = result.context.evidence
    .filter(item => exportedEvidenceIds.has(item.evidenceId))
    .sort((left, right) => left.eventIndex - right.eventIndex
      || left.evidenceId.localeCompare(right.evidenceId))
    .map(item => ({
      evidenceId: clean(item.evidenceId),
      eventIndex: item.eventIndex,
      origin: item.origin,
      ...optional('name', item.name === undefined ? undefined : clean(item.name)),
      ...optional('processId', item.processId),
      ...optional('threadId', item.threadId),
      ...optional('timestampUs', item.timestampUs),
    }));
  const limitations = [...new Set(cleanList([
    ...result.context.quality.warnings,
    ...result.context.quality.disabledCapabilities,
    ...result.context.warnings,
    ...diagnoses.flatMap(item => item.limitations),
    ...boundedRequests.flatMap(item => item.limitations),
    ...tasks.flatMap(item => item.limitations),
    ...(result.context.animationFrameSummary?.limitations ?? []),
    ...(result.context.interactionSummary?.limitations ?? []),
  ]))].sort();
  const facts = projectFactCounts(result);

  return {
    schemaVersion: 1,
    intakeSummary: projectIntake(result.intake),
    quality: projectQuality(result.context.quality),
    primaryDiagnosis,
    secondaryDiagnoses,
    milestones,
    boundedRequests,
    boundedTasks: { tasks, cpuHotspots },
    boundedRendering: { frames, events, reflow },
    boundedInteractions,
    referencedEvidence,
    limitations,
    truncation: {
      facts,
      evidence: {
        total: result.context.evidenceTotalCount,
        returned: result.context.evidenceReturnedCount,
        truncated: result.context.evidenceTotalCount > result.context.evidenceReturnedCount,
      },
    },
  };
}

function diagnosisLines(diagnosis: TraceExportDiagnosis): string[] {
  return [
    `### ${diagnosis.title}`,
    `- 规则：${diagnosis.ruleId}`,
    `- 严重程度：${diagnosis.severity}`,
    `- 置信度：${diagnosis.confidence}`,
    `- 评分：${diagnosis.score}`,
    '',
    diagnosis.conclusion,
    '',
    '#### 建议',
    ...(diagnosis.advice.length > 0 ? diagnosis.advice.map(item => `- ${item}`) : ['- 无']),
  ];
}

function renderTraceMarkdown(payload: TraceExportPayload): string {
  const lines = [
    '# Chromium Performance Trace 分析报告',
    '',
    '## 采集概览',
    `- 事件数：${payload.intakeSummary.eventCount}`,
    `- JSON 字节数：${payload.intakeSummary.jsonBytes}`,
    `- 采集质量：${payload.quality.level}`,
    '',
    '## 主要诊断',
    ...(payload.primaryDiagnosis ? diagnosisLines(payload.primaryDiagnosis) : ['- 未生成诊断结论']),
    '',
    '## 次要诊断',
  ];
  payload.secondaryDiagnoses.forEach(item => lines.push(...diagnosisLines(item), ''));
  if (payload.secondaryDiagnoses.length === 0) lines.push('- 无');
  lines.push(
    '',
    '## 有限事实',
    `- 里程碑：${payload.milestones.length}`,
    `- 请求：${payload.boundedRequests.length}`,
    `- 主线程任务：${payload.boundedTasks.tasks.length}`,
    `- CPU 热点：${payload.boundedTasks.cpuHotspots.length}`,
    `- 动画帧：${payload.boundedRendering.frames.length}`,
    `- 渲染事件：${payload.boundedRendering.events.length}`,
    `- 强制回流线索：${payload.boundedRendering.reflow.length}`,
    `- 交互：${payload.boundedInteractions.length}`,
    `- 引用证据：${payload.referencedEvidence.length}`,
    '',
    '### 关键请求',
    ...(payload.boundedRequests.length > 0
      ? payload.boundedRequests.map(item => (
        `- ${item.id} | ${item.method ?? 'unknown'} | ${item.url?.origin ?? ''}${item.url?.pathname ?? ''} | ${item.result} | ${item.durationMs ?? 'unknown'} ms`
      ))
      : ['- 无']),
    '',
    '### 关键任务',
    ...(payload.boundedTasks.tasks.length > 0
      ? payload.boundedTasks.tasks.map(item => (
        `- ${item.id} | ${item.durationMs} ms | blocking ${item.blockingContributionMs} ms | self ${item.selfTimeMs} ms`
      ))
      : ['- 无']),
    '',
    '### 关键渲染',
    ...payload.boundedRendering.frames.map(item => (
      `- frame ${item.id} | ${item.durationMs} ms | dropped ${item.dropped} | overBudget ${item.overBudget}`
    )),
    ...payload.boundedRendering.events.map(item => (
      `- event ${item.id} | ${item.name} | ${item.durationMs} ms`
    )),
    ...payload.boundedRendering.reflow.map(item => (
      `- reflow ${item.id} | ${item.confidence}${item.taskId ? ` | task ${item.taskId}` : ''}`
    )),
    ...(payload.boundedRendering.frames.length
      + payload.boundedRendering.events.length
      + payload.boundedRendering.reflow.length === 0 ? ['- 无'] : []),
    '',
    '### 关键交互',
    ...(payload.boundedInteractions.length > 0
      ? payload.boundedInteractions.map(item => (
        `- ${item.id} | total ${item.totalLatencyMs} ms | input ${item.inputDelayMs} ms | processing ${item.processingDurationMs} ms | presentation ${item.presentationDelayMs} ms`
      ))
      : ['- 无']),
    '',
    '### 引用证据',
    ...(payload.referencedEvidence.length > 0
      ? payload.referencedEvidence.map(item => (
        `- ${item.evidenceId} | eventIndex ${item.eventIndex}${item.name ? ` | ${item.name}` : ''}`
      ))
      : ['- 无']),
    '',
    '## 限制',
    ...(payload.limitations.length > 0 ? payload.limitations.map(item => `- ${item}`) : ['- 无']),
  );
  return `${lines.join('\n')}\n`;
}

export function buildTraceMarkdownReport(result: TraceAnalysisResult): string {
  return renderTraceMarkdown(buildTraceJsonExport(result));
}
