import type { TraceTaskFacts } from '../../../parsers/trace/types';
import { TRACE_RULE_THRESHOLDS, severityForThreshold } from '../traceRuleThresholds';
import type { TraceDiagnosisRule } from '../types';
import { disabled, insufficientQuality, matched, notMatched } from './ruleSupport';

function taskHotspot(tasks: readonly TraceTaskFacts[]) {
  return tasks.flatMap(task => (['script', 'gc'] as const).flatMap(category => {
    const selfTimeMs = task.categorySelfTimeMs[category] ?? 0;
    return selfTimeMs > 0 ? [{ task, category, selfTimeMs }] : [];
  })).sort((a, b) => b.selfTimeMs - a.selfTimeMs)[0];
}

export const mainThreadRules: readonly TraceDiagnosisRule[] = [{
  id: 'M1', category: 'main-thread', requiredFacts: ['tasks', 'renderer main thread mapping'],
  forbiddenConclusions: ['长任务 duration 总和是 TBT'],
  evaluate: context => {
    const quality = insufficientQuality(context, 'M1');
    if (quality) return [quality];
    if (context.quality.rendererMainThread === 'missing') return [disabled('M1', 'CAPABILITY_DISABLED')];
    if (!context.tasks?.length) return [disabled('M1', 'REQUIRED_FACTS_MISSING')];
    const longTasks = context.tasks.filter(item => item.durationMs >= TRACE_RULE_THRESHOLDS.longTaskMs.warning);
    if (!longTasks.length) return [notMatched('M1', '未记录超过 50ms 的目标主线程任务。')];
    return longTasks.map(task => {
      const severity = severityForThreshold(task.durationMs, TRACE_RULE_THRESHOLDS.longTaskMs)!;
      return matched({
        context, ruleId: 'M1', category: 'main-thread', severity, evidenceStrength: 'direct',
        impactRatio: task.blockingContributionMs / Math.max(task.durationMs, 1),
        title: '主线程长任务',
        conclusion: `任务持续 ${task.durationMs}ms，超过 50ms 部分为 ${task.blockingContributionMs}ms。`,
        confidence: 'confirmed', evidenceIds: task.evidenceIds,
        counterEvidence: ['单任务 blocking contribution 不等于页面 TBT。'],
        factIds: [task.id], navigationKey: task.navigationKey,
        advice: ['拆分长任务，并检查其 self time 主要类别。'],
        limitations: ['这里只展示单任务阻塞贡献，不计算 Web Vitals 总阻塞时间。'],
        metric: { value: task.durationMs, unit: 'ms', warningThreshold: TRACE_RULE_THRESHOLDS.longTaskMs.warning, criticalThreshold: TRACE_RULE_THRESHOLDS.longTaskMs.critical },
      });
    });
  },
}, {
  id: 'M2', category: 'main-thread', requiredFacts: ['cpuHotspots or task script/gc self time'],
  forbiddenConclusions: ['无 Source Map 猜测业务函数'],
  evaluate: context => {
    const quality = insufficientQuality(context, 'M2');
    if (quality) return [quality];
    const hotspot = [...(context.cpuHotspots ?? [])].sort((a, b) => b.sampleTimeMs - a.sampleTimeMs)[0];
    const taskFact = taskHotspot(context.tasks ?? []);
    if (!hotspot && !taskFact) return [disabled('M2', 'REQUIRED_FACTS_MISSING')];
    if (hotspot && hotspot.sampleTimeMs >= (taskFact?.selfTimeMs ?? 0)) {
      const severity = severityForThreshold(
        hotspot.sampleTimeMs,
        TRACE_RULE_THRESHOLDS.cpuHotspotSampleTimeMs,
      );
      if (!severity) return [notMatched('M2', 'CPU 采样热点未超过阈值。')];
      const location = hotspot.script?.pathname ?? '(脚本位置未知)';
      return [matched({
        context, ruleId: 'M2', category: 'main-thread', severity, evidenceStrength: 'derived',
        impactRatio: hotspot.sampleTimeMs / TRACE_RULE_THRESHOLDS.cpuHotspotSampleTimeMs.critical,
        title: '脚本采样热点',
        conclusion: `${location} 的 ${hotspot.functionName} 累计采样时间 ${hotspot.sampleTimeMs}ms。`,
        confidence: 'medium', evidenceIds: hotspot.evidenceIds,
        counterEvidence: ['采样热点只覆盖已采集样本，不代表完整 CPU 调用栈。'],
        factIds: [hotspot.id], navigationKey: hotspot.navigationKey,
        advice: ['结合 bundle 行列和 Source Map 在源码侧进一步定位。'],
        limitations: ['当前结果未消费 Source Map，只定位 bundle、函数记录和行列，不猜测业务函数。'],
        metric: {
          value: hotspot.sampleTimeMs,
          unit: 'ms',
          warningThreshold: TRACE_RULE_THRESHOLDS.cpuHotspotSampleTimeMs.warning,
          criticalThreshold: TRACE_RULE_THRESHOLDS.cpuHotspotSampleTimeMs.critical,
        },
      })];
    }
    const { task, category, selfTimeMs } = taskFact!;
    const severity = severityForThreshold(selfTimeMs, TRACE_RULE_THRESHOLDS.longTaskMs);
    if (!severity) return [notMatched('M2', '任务脚本或 GC self time 未超过阈值。')];
    const label = category === 'gc' ? 'GC' : '脚本';
    return [matched({
      context, ruleId: 'M2', category: 'main-thread', severity, evidenceStrength: 'direct',
      impactRatio: selfTimeMs / Math.max(task.durationMs, 1), title: `${label} self time 热点`,
      conclusion: `任务中的${label} self time 为 ${selfTimeMs}ms。`,
      confidence: task.selfTimeConfidence === 'exact' ? 'high' : 'medium',
      evidenceIds: task.evidenceIds,
      counterEvidence: ['该分类来自 Trace self time，不代表完整业务调用栈。'],
      factIds: [task.id], navigationKey: task.navigationKey,
      advice: category === 'gc' ? ['检查分配压力和对象生命周期。'] : ['检查任务内脚本执行和微任务拆分机会。'],
      limitations: task.selfTimeConfidence === 'exact' ? [] : ['phase 配对不完整，self time 为 approximate。'],
      metric: { value: selfTimeMs, unit: 'ms', warningThreshold: TRACE_RULE_THRESHOLDS.longTaskMs.warning, criticalThreshold: TRACE_RULE_THRESHOLDS.longTaskMs.critical },
    })];
  },
}];
