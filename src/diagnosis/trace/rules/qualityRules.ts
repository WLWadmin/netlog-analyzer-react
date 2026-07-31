import type { TraceDiagnosisRule } from '../types';
import { disabled, matched, notMatched } from './ruleSupport';

export const qualityRules: readonly TraceDiagnosisRule[] = [{
  id: 'Q1',
  category: 'quality',
  requiredFacts: ['quality', 'navigations', 'evidence'],
  forbiddenConclusions: ['页面没有 FCP/LCP', 'FCP/LCP 不存在'],
  evaluate: context => {
    const incomplete = context.quality.captureWindow !== 'available'
      || context.quality.navigationContext !== 'available'
      || context.quality.skippedEventCount > 0;
    if (!incomplete) return [notMatched('Q1', '采集窗口与导航上下文完整。')];
    const evidenceIds = context.navigations.flatMap(item => item.evidenceIds).slice(0, 3);
    if (evidenceIds.length === 0) evidenceIds.push(...context.evidence.slice(0, 1).map(item => item.evidenceId));
    if (evidenceIds.length === 0) return [disabled('Q1', 'EVIDENCE_MISSING')];
    return [matched({
      context, ruleId: 'Q1', category: 'quality', severity: 'warning',
      evidenceStrength: 'direct', impactRatio: 1, title: 'Trace 采集范围不完整',
      conclusion: '当前录制边界或导航上下文不完整，页面里程碑只能视为未采集到。',
      confidence: 'observation', evidenceIds,
      counterEvidence: ['采集缺失不等于页面事件未发生。'], factIds: [],
      advice: ['从导航开始前重新录制，并覆盖问题发生后的页面阶段。'],
      limitations: ['不能依据缺失事件判断页面里程碑是否实际发生。'],
    })];
  },
}];
