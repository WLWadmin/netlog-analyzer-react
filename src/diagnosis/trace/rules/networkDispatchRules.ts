import { TRACE_RULE_THRESHOLDS, severityForThreshold } from '../traceRuleThresholds';
import type { TraceDiagnosisRule } from '../types';
import {
  disabled,
  insufficientQuality,
  matched,
  missingRequiredEventFamilies,
  notMatched,
} from './ruleSupport';

export const networkDispatchRules: readonly TraceDiagnosisRule[] = [{
  id: 'N1', category: 'network', requiredFacts: ['requests.statusCode'],
  forbiddenConclusions: ['HTTP 错误等同网络传输失败'],
  evaluate: context => {
    const quality = insufficientQuality(context, 'N1');
    if (quality) return [quality];
    const family = missingRequiredEventFamilies(context, 'N1', ['network']);
    if (family) return [family];
    if (!context.requests?.length) return [disabled('N1', 'REQUIRED_FACTS_MISSING')];
    const errors = context.requests.filter(item => (item.statusCode ?? 0) >= 400);
    if (!errors.length) return [notMatched('N1', '未记录 HTTP 4xx/5xx。')];
    return errors.map(request => matched({
      context, ruleId: 'N1', category: 'network',
      severity: (request.statusCode ?? 0) >= 500 ? 'critical' : 'warning',
      evidenceStrength: 'direct', impactRatio: 1, title: `HTTP ${request.statusCode}`,
      conclusion: `请求记录了 HTTP ${request.statusCode} 响应，这是应用层 HTTP 结果。`,
      confidence: 'observation', evidenceIds: request.evidenceIds,
      counterEvidence: ['存在 HTTP 响应，不能归类为网络传输失败。'], factIds: [request.id],
      navigationKey: request.navigationKey,
      advice: ['由接口或资源负责人核对该 HTTP 状态及响应语义。'],
      limitations: ['HTTP 状态不能证明底层网络传输根因。'],
    }));
  },
}, {
  id: 'N2', category: 'network', requiredFacts: ['requests.failed', 'requests.statusCode'],
  forbiddenConclusions: ['DNS 根因', 'TLS 根因', '代理根因'],
  evaluate: context => {
    const quality = insufficientQuality(context, 'N2');
    if (quality) return [quality];
    const family = missingRequiredEventFamilies(context, 'N2', ['network']);
    if (family) return [family];
    if (!context.requests?.length) return [disabled('N2', 'REQUIRED_FACTS_MISSING')];
    const failures = context.requests.filter(item => item.result === 'transport-failed' && item.statusCode === undefined);
    if (!failures.length) return [notMatched('N2', '未记录无 HTTP 响应的传输失败。')];
    return failures.map(request => matched({
      context, ruleId: 'N2', category: 'network', severity: 'warning', evidenceStrength: 'direct',
      impactRatio: 1, title: '请求存在传输失败线索',
      conclusion: '请求在没有 HTTP 响应的情况下记录为失败；仅凭 Trace 不能区分底层网络阶段。',
      confidence: 'observation', evidenceIds: request.evidenceIds,
      counterEvidence: ['Trace 未包含底层网络阶段证据，无法区分 DNS、TLS、代理或服务端。'], factIds: [request.id],
      navigationKey: request.navigationKey,
      advice: ['补采同次 NetLog 以检查 DNS、连接、TLS 或代理阶段。'],
      limitations: ['不推断 DNS、TLS、代理或服务端根因。'],
    }));
  },
}, {
  id: 'N3', category: 'network', requiredFacts: ['requests.dispatch', 'renderer main thread mapping'],
  forbiddenConclusions: ['派发等待等同 TTFB'],
  evaluate: context => {
    const quality = insufficientQuality(context, 'N3');
    if (quality) return [quality];
    const family = missingRequiredEventFamilies(context, 'N3', ['network', 'main-thread']);
    if (family) return [family];
    if (!context.requests?.length) return [disabled('N3', 'REQUIRED_FACTS_MISSING')];
    const calibrated = context.requests.filter(item => item.dispatch
      && !item.limitations.includes('dispatch-time-domain-unavailable'));
    if (!calibrated.length) return [disabled('N3', 'TIMING_DOMAIN_UNCALIBRATED')];
    const overlapped = calibrated.filter(item => item.dispatch!.mainThreadOverlapMs > 0);
    if (!overlapped.length) {
      return [notMatched('N3', '时间域已校准，但未观察到主线程忙碌重叠。')];
    }
    const slow = overlapped.filter(item => severityForThreshold(
      item.dispatch!.dispatchWaitMs, TRACE_RULE_THRESHOLDS.rendererQueueMs,
    ));
    if (!slow.length) return [notMatched('N3', '主线程派发等待未超过阈值。')];
    return slow.map(request => {
      const value = request.dispatch!.dispatchWaitMs;
      const severity = severityForThreshold(value, TRACE_RULE_THRESHOLDS.rendererQueueMs)!;
      return matched({
        context, ruleId: 'N3', category: 'network', severity, evidenceStrength: 'derived',
        impactRatio: request.dispatch!.mainThreadOverlapMs / value,
        title: '网络响应后的主线程派发等待',
        conclusion: `网络响应可观察点到 Renderer 处理之间等待 ${value}ms，其中 ${request.dispatch!.mainThreadOverlapMs}ms 与主线程忙碌重叠。`,
        confidence: 'high', evidenceIds: request.evidenceIds,
        counterEvidence: ['网络自身耗时与主线程派发等待是独立区间。'], factIds: [request.id],
        navigationKey: request.navigationKey,
        advice: ['检查重叠时段内的主线程长任务。'],
        limitations: ['该指标是派发等待，不代表网络首字节时间。'],
        metric: { value, unit: 'ms', warningThreshold: TRACE_RULE_THRESHOLDS.rendererQueueMs.warning, criticalThreshold: TRACE_RULE_THRESHOLDS.rendererQueueMs.critical },
      });
    });
  },
}, {
  id: 'C1', category: 'network', requiredFacts: ['requests.result', 'navigations'],
  forbiddenConclusions: ['导航重叠必然导致取消'],
  evaluate: context => {
    const quality = insufficientQuality(context, 'C1');
    if (quality) return [quality];
    const family = missingRequiredEventFamilies(context, 'C1', ['network', 'navigation']);
    if (family) return [family];
    if (!context.requests?.length) return [disabled('C1', 'REQUIRED_FACTS_MISSING')];
    const cancelled = context.requests.filter(item => item.result === 'cancelled');
    if (!cancelled.length) return [notMatched('C1', '未记录取消请求。')];
    return cancelled.map(request => matched({
      context, ruleId: 'C1', category: 'network', severity: 'info',
      evidenceStrength: request.resultConfidence === 'high' ? 'direct' : 'clue', impactRatio: 1,
      title: '请求取消线索', conclusion: '请求被归类为取消；若仅有导航时间重叠，该结果仍是线索。',
      confidence: request.resultConfidence === 'high' ? 'confirmed' : 'observation',
      evidenceIds: request.evidenceIds,
      counterEvidence: ['仅有导航重叠时，请求也可能因录制结束或其他原因未完成。'],
      factIds: [request.id], navigationKey: request.navigationKey,
      advice: ['核对用户操作、重复导航和请求自身取消信号。'],
      limitations: request.resultConfidence === 'high' ? [] : ['导航重叠不能单独证明取消原因。'],
    }));
  },
}, {
  id: 'S1', category: 'security', requiredFacts: ['requests.statusCode'],
  forbiddenConclusions: ['安全策略是性能根因'],
  evaluate: context => {
    const quality = insufficientQuality(context, 'S1');
    if (quality) return [quality];
    const family = missingRequiredEventFamilies(context, 'S1', ['network']);
    if (family) return [family];
    if (!context.requests?.length) return [disabled('S1', 'REQUIRED_FACTS_MISSING')];
    const observations = context.requests.filter(item => item.statusCode === 401 || item.statusCode === 403);
    if (!observations.length) return [notMatched('S1', '未记录明确的认证或拒绝状态。')];
    return observations.map(request => matched({
      context, ruleId: 'S1', category: 'security', severity: 'info', evidenceStrength: 'direct',
      impactRatio: 1, title: '安全或访问策略观察',
      conclusion: `请求记录了 HTTP ${request.statusCode}，可作为认证或访问策略观察。`,
      confidence: 'observation', evidenceIds: request.evidenceIds,
      counterEvidence: ['HTTP 状态只能确认响应事实，不能确定具体安全策略或性能影响。'],
      factIds: [request.id], navigationKey: request.navigationKey,
      advice: ['由权限或网关负责人核对请求对应的访问策略。'],
      limitations: ['该观察不能作为性能根因，也不能仅凭状态码确定具体策略。'],
    }));
  },
}];
