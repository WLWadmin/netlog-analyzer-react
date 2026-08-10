import type { TraceCpuHotspot, TraceTaskFacts } from '../../../parsers/trace/types';
import { TRACE_RULE_THRESHOLDS, severityForThreshold } from '../traceRuleThresholds';
import type { TraceDiagnosisRule } from '../types';
import { disabled, insufficientQuality, matched, notMatched } from './ruleSupport';

function taskHotspot(tasks: readonly TraceTaskFacts[]) {
  return tasks.flatMap(task => (['script', 'gc'] as const).flatMap(category => {
    const selfTimeMs = task.categorySelfTimeMs[category] ?? 0;
    return selfTimeMs > 0 ? [{ task, category, selfTimeMs }] : [];
  })).sort((a, b) => b.selfTimeMs - a.selfTimeMs)[0];
}

const CPU_RUNTIME_BUCKETS = new Set([
  '(garbage collector)',
  '(idle)',
  '(program)',
  '(root)',
]);

function isAttributableCpuHotspot(hotspot: TraceCpuHotspot): boolean {
  const functionName = hotspot.functionName.trim().toLowerCase();
  return functionName.length > 0 && !CPU_RUNTIME_BUCKETS.has(functionName);
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
    const hotspots = [...(context.cpuHotspots ?? [])]
      .sort((a, b) => b.sampleTimeMs - a.sampleTimeMs);
    const hotspot = hotspots.find(isAttributableCpuHotspot);
    const unattributableHotspot = hotspots.find(item => !isAttributableCpuHotspot(item));
    const taskFact = taskHotspot(context.tasks ?? []);
    if (!hotspot && !unattributableHotspot && !taskFact) {
      return [disabled('M2', 'REQUIRED_FACTS_MISSING')];
    }
    if (hotspot && hotspot.sampleTimeMs >= (taskFact?.selfTimeMs ?? 0)) {
      const severity = severityForThreshold(
        hotspot.sampleTimeMs,
        TRACE_RULE_THRESHOLDS.cpuHotspotSampleTimeMs,
      );
      if (severity) {
        const location = hotspot.script?.pathname ?? '(脚本位置未知)';
        return [matched({
          context, ruleId: 'M2', category: 'main-thread', severity, evidenceStrength: 'derived',
          impactRatio: hotspot.sampleTimeMs / TRACE_RULE_THRESHOLDS.cpuHotspotSampleTimeMs.critical,
          title: '发现脚本采样集中',
          conclusion: `CPU 采样较多地落在 ${location} 的 ${hotspot.functionName}，累计 ${hotspot.sampleTimeMs}ms；这只是关联线索，尚不能证明它是卡顿原因。`,
          confidence: 'medium', evidenceIds: hotspot.evidenceIds,
          counterEvidence: ['采样热点只覆盖已采集样本，不代表完整 CPU 调用栈。'],
          factIds: [hotspot.id], navigationKey: hotspot.navigationKey,
          advice: ['请让开发人员根据记录的脚本位置和 Source Map 继续定位源码。'],
          limitations: ['当前结果未消费 Source Map，只定位 bundle、函数记录和行列，不猜测业务函数。'],
          metric: {
            value: hotspot.sampleTimeMs,
            unit: 'ms',
            warningThreshold: TRACE_RULE_THRESHOLDS.cpuHotspotSampleTimeMs.warning,
            criticalThreshold: TRACE_RULE_THRESHOLDS.cpuHotspotSampleTimeMs.critical,
          },
        })];
      }
    }
    if (!taskFact && unattributableHotspot) {
      const severity = severityForThreshold(
        unattributableHotspot.sampleTimeMs,
        TRACE_RULE_THRESHOLDS.cpuHotspotSampleTimeMs,
      );
      if (!severity) return [notMatched('M2', '无法归属的 CPU 采样未超过提示阈值。')];
      return [matched({
        context,
        ruleId: 'M2',
        category: 'main-thread',
        severity: 'info',
        evidenceStrength: 'clue',
        impactRatio: 0,
        title: '未能定位具体脚本',
        conclusion: `CPU 采样中有 ${unattributableHotspot.sampleTimeMs}ms 无法归属到具体脚本或函数，当前不能确认脚本热点。`,
        confidence: 'observation',
        evidenceIds: unattributableHotspot.evidenceIds,
        counterEvidence: [`主要采样节点为 ${unattributableHotspot.functionName}，它不是可定位的业务脚本函数。`],
        factIds: [unattributableHotspot.id],
        navigationKey: unattributableHotspot.navigationKey,
        advice: [
          '请重新录制包含完整 JavaScript 调用信息的 Performance Trace。',
          '如果页面已经发布，请让开发人员确认 Source Map 可用后再次定位。',
        ],
        limitations: ['当前 CPU 采样缺少可定位的脚本路径或业务函数，无法完成代码归因。'],
      })];
    }
    if (!taskFact) return [notMatched('M2', 'CPU 采样热点未超过阈值。')];
    const { task, category, selfTimeMs } = taskFact;
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
