import { TRACE_RULE_THRESHOLDS, severityForThreshold } from '../traceRuleThresholds';
import type { TraceDiagnosisRule } from '../types';
import { disabled, insufficientQuality, matched, notMatched } from './ruleSupport';

export const loadingRules: readonly TraceDiagnosisRule[] = [{
  id: 'L1', category: 'loading', requiredFacts: ['navigations', 'milestones'],
  forbiddenConclusions: ['LCP Candidate 是最终 LCP'],
  evaluate: context => {
    const quality = insufficientQuality(context, 'L1');
    if (quality) return [quality];
    if (!context.milestones?.length) return [disabled('L1', 'REQUIRED_FACTS_MISSING')];
    const candidates = context.milestones.filter(item => (
      severityForThreshold(item.relativeUs / 1000, TRACE_RULE_THRESHOLDS.pageMilestoneMs)
    ));
    if (!candidates.length) return [notMatched('L1', '关键里程碑未超过阈值。')];
    return candidates.map(item => {
      const value = item.relativeUs / 1000;
      const severity = severityForThreshold(value, TRACE_RULE_THRESHOLDS.pageMilestoneMs)!;
      const label = item.name === 'LCP' && item.candidate ? 'LCP Candidate' : item.name;
      return matched({
        context, ruleId: 'L1', category: 'loading', severity, evidenceStrength: 'direct',
        impactRatio: value / TRACE_RULE_THRESHOLDS.pageMilestoneMs.critical,
        title: `${label} 较慢`, conclusion: `${label} 在导航后 ${value}ms 被记录。`,
        confidence: item.candidate ? 'observation' : 'confirmed', evidenceIds: item.evidenceIds,
        counterEvidence: ['候选状态或采集窗口可能使最终里程碑值变化。'],
        factIds: [item.id], navigationKey: item.navigationKey,
        advice: ['结合该里程碑前的请求、主线程任务和渲染事实继续定位贡献。'],
        limitations: item.candidate ? ['该记录是候选值，不能作为最终 LCP。'] : [],
        metric: { value, unit: 'ms', warningThreshold: TRACE_RULE_THRESHOLDS.pageMilestoneMs.warning, criticalThreshold: TRACE_RULE_THRESHOLDS.pageMilestoneMs.critical },
      });
    });
  },
}, {
  id: 'L2', category: 'loading',
  requiredFacts: ['navigation document', 'Network and CPU dependency edges', 'FCP/LCP critical window'],
  forbiddenConclusions: ['关键链是唯一根因'],
  evaluate: context => {
    const quality = insufficientQuality(context, 'L2');
    if (quality) return [quality];
    if (!context.requests?.length) return [disabled('L2', 'REQUIRED_FACTS_MISSING')];
    // 请求 initiator 链不包含 CPU 阻塞边，不能冒充 PRD 定义的 Network + CPU 关键路径。
    return [disabled('L2', 'DEPENDENCY_PATH_INCOMPLETE')];
  },
}];
