import { TRACE_RULE_THRESHOLDS, severityForThreshold } from '../traceRuleThresholds';
import type { TraceDiagnosisRule } from '../types';
import {
  disabled,
  insufficientQuality,
  matched,
  missingRequiredEventFamilies,
  notMatched,
} from './ruleSupport';

export const interactionRules: readonly TraceDiagnosisRule[] = [{
  id: 'I1', category: 'interaction', requiredFacts: ['interactions with three timing phases'],
  forbiddenConclusions: ['Trace 最慢交互代表线上 INP'],
  evaluate: context => {
    const quality = insufficientQuality(context, 'I1');
    if (quality) return [quality];
    const family = missingRequiredEventFamilies(context, 'I1', ['interaction']);
    if (family) return [family];
    if (!context.interactions?.length) return [disabled('I1', 'REQUIRED_FACTS_MISSING')];
    const slow = context.interactions.filter(item => severityForThreshold(
      item.totalLatencyMs, TRACE_RULE_THRESHOLDS.interactionLatencyMs,
    ));
    if (!slow.length) return [notMatched('I1', '交互总延迟未超过阈值。')];
    return slow.map(item => {
      const severity = severityForThreshold(item.totalLatencyMs, TRACE_RULE_THRESHOLDS.interactionLatencyMs)!;
      const largest = Math.max(item.inputDelayMs, item.processingDurationMs, item.presentationDelayMs);
      return matched({
        context, ruleId: 'I1', category: 'interaction', severity, evidenceStrength: 'direct',
        impactRatio: largest / Math.max(item.totalLatencyMs, 1), title: 'Trace 内慢交互候选',
        conclusion: `Trace 内交互候选总延迟 ${item.totalLatencyMs}ms：输入等待 ${item.inputDelayMs}ms、处理 ${item.processingDurationMs}ms、呈现等待 ${item.presentationDelayMs}ms。`,
        confidence: 'high', evidenceIds: item.evidenceIds,
        counterEvidence: ['单次 Trace 采集窗口不能代表线上用户分布或最终 INP。'],
        factIds: [item.id, ...item.taskIds, ...item.renderingEventIds, ...item.frameIds],
        navigationKey: item.navigationKey,
        advice: ['优先检查占比最大的阶段及其关联任务、渲染事件和帧。'],
        limitations: ['单份 Trace 的交互候选不代表真实用户分布或线上 Web Vitals。'],
        metric: { value: item.totalLatencyMs, unit: 'ms', warningThreshold: TRACE_RULE_THRESHOLDS.interactionLatencyMs.warning, criticalThreshold: TRACE_RULE_THRESHOLDS.interactionLatencyMs.critical },
      });
    });
  },
}];
