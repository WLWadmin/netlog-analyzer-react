import type { CorrelationCandidate } from '../../workbench/crossSourceProtocol';
import type { ConnectionPath } from './crossSourceCorrelation';

export interface CrossSourceDiagnosisFinding {
  findingId: string;
  title: string;
  phase: ConnectionPath['phases'][number]['phase'];
  entityIds: string[];
  evidenceIds: string[];
  limitations: string[];
  verificationSteps: string[];
}

const PHASE_LABEL: Record<
  CrossSourceDiagnosisFinding['phase'],
  string
> = {
  dns: 'DNS',
  connect: 'TCP 连接',
  tls: 'TLS',
  socket: 'Socket',
  proxy: '代理',
};

export function buildCrossSourceDiagnosisFindings(input: {
  candidates: CorrelationCandidate[];
  connectionPaths: ConnectionPath[];
}): CrossSourceDiagnosisFinding[] {
  return input.candidates.flatMap(candidate => {
    if (
      candidate.confidence !== 'high'
      || !candidate.allowsDiagnosisUpgrade
      || candidate.conflictingFields.length > 0
    ) return [];
    return input.connectionPaths
      .filter(path => candidate.entityIds.includes(path.entityId))
      .flatMap(path => path.phases.map(phase => ({
        findingId: `cross-source:${candidate.correlationId}:${phase.phase}`,
        title: `${PHASE_LABEL[phase.phase]} 阶段存在明确跨源证据`,
        phase: phase.phase,
        entityIds: [...candidate.entityIds],
        evidenceIds: [...candidate.evidenceIds, ...phase.evidenceIds],
        limitations: [
          `${PHASE_LABEL[phase.phase]} 事件存在不等于该阶段是性能根因。`,
          '需要阶段耗时、失败或症状重叠证据后才能升级归因。',
        ],
        verificationSteps: [
          `检查 NetLog ${PHASE_LABEL[phase.phase]} 事件及对应请求范围。`,
        ],
      })));
  });
}
