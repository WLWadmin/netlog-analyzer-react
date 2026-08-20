import { TRACE_RULE_THRESHOLDS, severityForThreshold } from '../traceRuleThresholds';
import type { TraceDiagnosisRule } from '../types';
import {
  disabled,
  insufficientQuality,
  matched,
  missingRequiredEventFamilies,
  notMatched,
} from './ruleSupport';

const RENDERING_BOTTLENECK_NAMES = new Set(['Layout', 'Paint', 'RasterTask']);

export const renderingRules: readonly TraceDiagnosisRule[] = [{
  id: 'R1', category: 'rendering', requiredFacts: ['forcedReflowClues'],
  forbiddenConclusions: ['弱布局线索确定具体 DOM API 根因'],
  evaluate: context => {
    const quality = insufficientQuality(context, 'R1');
    if (quality) return [quality];
    const family = missingRequiredEventFamilies(context, 'R1', ['rendering']);
    if (family) return [family];
    if (!context.forcedReflowClues?.length) return [disabled('R1', 'REQUIRED_FACTS_MISSING')];
    return context.forcedReflowClues.map(clue => matched({
      context, ruleId: 'R1', category: 'rendering', severity: 'warning',
      evidenceStrength: clue.confidence === 'explicit' ? 'direct' : 'clue', impactRatio: 1,
      title: '强制布局线索',
      conclusion: clue.confidence === 'explicit'
        ? 'Trace 记录了显式强制布局线索。'
        : 'Layout 与附加上下文形成强制布局观察线索。',
      confidence: clue.confidence === 'explicit' ? 'high' : 'observation',
      evidenceIds: clue.evidenceIds,
      counterEvidence: clue.confidence === 'explicit' ? [] : ['缺少显式 warning 或 invalidation 时，Layout 只能作为观察线索。'],
      factIds: [clue.id, ...(clue.taskId ? [clue.taskId] : [])], navigationKey: clue.navigationKey,
      advice: ['检查同一任务中的 DOM 读写顺序和 invalidation 上下文。'],
      limitations: clue.confidence === 'explicit' ? [] : ['无显式 warning 时不能确定具体 DOM API 根因。'],
    }));
  },
}, {
  id: 'R2', category: 'rendering', requiredFacts: ['animation frames or Layout/Paint/Raster facts'],
  forbiddenConclusions: ['compositor 耗时全部归因主线程'],
  evaluate: context => {
    const quality = insufficientQuality(context, 'R2');
    if (quality) return [quality];
    const family = missingRequiredEventFamilies(context, 'R2', ['rendering']);
    if (family) return [family];
    const summary = context.animationFrameSummary;
    if (summary && context.animationFrames?.length) {
      const ratio = summary.totalCount === 0 ? 0 : summary.overBudgetCount / summary.totalCount;
      const severity = severityForThreshold(ratio, TRACE_RULE_THRESHOLDS.droppedFrameRatio);
      if (severity) {
        const frames = context.animationFrames.filter(item => item.overBudget || item.dropped);
        return [matched({
          context, ruleId: 'R2', category: 'rendering', severity, evidenceStrength: 'direct',
          impactRatio: ratio, title: '渲染帧超出参考预算',
          conclusion: `${summary.overBudgetCount}/${summary.totalCount} 帧超过 16.7ms 参考预算，最大帧 ${summary.maxDurationMs}ms。`,
          confidence: summary.completeness === 'complete' ? 'high' : 'medium',
          evidenceIds: frames.flatMap(item => item.evidenceIds).slice(0, 20),
          counterEvidence: ['帧超预算事实未自动归因到主线程或 compositor。'],
          factIds: frames.map(item => item.id),
          advice: ['分别检查主线程 Layout/Paint 与 compositor/raster 事实。'],
          limitations: ['16.7ms 仅为 60Hz 参考预算，设备刷新率未知；不把 compositor 耗时归到主线程。', ...summary.limitations],
          metric: { value: ratio, unit: 'ratio', warningThreshold: TRACE_RULE_THRESHOLDS.droppedFrameRatio.warning, criticalThreshold: TRACE_RULE_THRESHOLDS.droppedFrameRatio.critical },
        })];
      }
    }
    const rendering = (context.rendering ?? []).filter(item => RENDERING_BOTTLENECK_NAMES.has(item.name))
      .sort((a, b) => b.durationMs - a.durationMs)[0];
    if (!rendering) {
      return summary ? [notMatched('R2', '超预算帧比例未超过阈值。')]
        : [disabled('R2', 'REQUIRED_FACTS_MISSING')];
    }
    const severity = severityForThreshold(rendering.durationMs, TRACE_RULE_THRESHOLDS.renderingEventMs);
    if (!severity) return [notMatched('R2', 'Layout/Paint/Raster 耗时未超过阈值。')];
    return [matched({
      context, ruleId: 'R2', category: 'rendering', severity, evidenceStrength: 'direct',
      impactRatio: rendering.durationMs / TRACE_RULE_THRESHOLDS.renderingEventMs.critical,
      title: `${rendering.name} 耗时较长`,
      conclusion: `${rendering.name} 事件持续 ${rendering.durationMs}ms。`,
      confidence: 'confirmed', evidenceIds: rendering.evidenceIds,
      counterEvidence: ['未将该渲染事件自动归因到主线程或 compositor。'],
      factIds: [rendering.id], navigationKey: rendering.navigationKey,
      advice: ['结合事件线程、关联任务和帧事实判断具体贡献阶段。'],
      limitations: ['单个渲染事件不能证明全部帧瓶颈，也不混淆主线程与 compositor。'],
      metric: { value: rendering.durationMs, unit: 'ms', warningThreshold: TRACE_RULE_THRESHOLDS.renderingEventMs.warning, criticalThreshold: TRACE_RULE_THRESHOLDS.renderingEventMs.critical },
    })];
  },
}];
