import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Tag } from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  buildTroubleshootingPlan,
  continueTroubleshootingSession,
  correctLastTroubleshootingOutcome,
  createTroubleshootingSession,
  currentTroubleshootingStep,
  getRelevantRoleTasks,
  recordTroubleshootingOutcome,
  type FinalDiagnosisSummary,
  type TroubleshootingOutcome,
  type TroubleshootingSession,
} from '../../diagnosis/shared';

interface NoviceTroubleshootingFlowProps {
  finalSummary: FinalDiagnosisSummary;
  onRecordTextChange?: (text: string) => void;
  onOpenHarRequests?: (requestIds: number[]) => void;
  onOpenNetlogEvidence?: (sourceIds: number[], eventIds: string[]) => void;
}

const OUTCOME_LABELS: Record<TroubleshootingOutcome, string> = {
  improved: '恢复正常',
  unchanged: '仍有问题',
  worse: '情况变差',
};

const NoviceTroubleshootingFlow: React.FC<NoviceTroubleshootingFlowProps> = ({
  finalSummary,
  onRecordTextChange,
  onOpenHarRequests,
  onOpenNetlogEvidence,
}) => {
  const plan = useMemo(() => buildTroubleshootingPlan(finalSummary), [finalSummary]);
  const [session, setSession] = useState<TroubleshootingSession>(() => createTroubleshootingSession(plan));
  useEffect(() => setSession(createTroubleshootingSession(plan)), [plan]);

  const step = currentTroubleshootingStep(plan, session);
  const lastRecord = session.history[session.history.length - 1];
  const roleTasks = getRelevantRoleTasks(plan, session);
  const headline = finalSummary.headline[0];
  const relatedCards = finalSummary.expertCards.filter(card => headline?.relatedCardIds.includes(card.id));
  const evidence = headline?.keyEvidence[0] || relatedCards.flatMap(card => card.evidence).find(item => !item.conflictWith);
  const counterEvidence = relatedCards.flatMap(card => card.evidence).find(item => item.conflictWith);
  const missing = headline?.missingInfo[0] || finalSummary.missingInfo[0];
  const requestIds = Array.from(new Set([
    ...(headline?.keyEvidence.flatMap(item => item.requestIds || []) || []),
    ...relatedCards.flatMap(card => card.relatedRequestIds || []),
    ...relatedCards.flatMap(card => card.evidence.flatMap(item => item.requestIds || [])),
  ]));
  const sourceIds = Array.from(new Set(relatedCards.flatMap(card => [
    ...(card.relatedSourceIds || []),
    ...card.evidence.flatMap(item => item.sourceIds || []),
  ])));
  const eventIds = Array.from(new Set([
    ...(headline?.keyEvidence.flatMap(item => item.eventIds || []) || []),
    ...relatedCards.flatMap(card => card.evidence.flatMap(item => item.eventIds || [])),
  ]));
  const hasRequestLink = requestIds.length > 0 && Boolean(onOpenHarRequests);
  const hasNetlogLink = (sourceIds.length > 0 || eventIds.length > 0) && Boolean(onOpenNetlogEvidence);

  useEffect(() => {
    if (!onRecordTextChange) return;
    const currentAction = currentTroubleshootingStep(plan, session);
    const currentText = currentAction && session.state === 'ACTION_PENDING'
      ? `当前行动：${currentAction.actionTitle}。${currentAction.actionDetail}\n预期观察：${currentAction.expectedObservation}\n前提：${currentAction.prerequisite}\n回退：${currentAction.rollback || '不修改系统设置'}`
      : `当前状态：${session.state === 'DIRECTION_SUPPORTED' ? '用户反馈恢复，方向待复核' : session.state === 'ROLLBACK_REQUIRED' ? '等待还原确认' : session.state === 'NEXT_ACTION' ? '等待进入下一步' : '准备转交处理'}`;
    if (session.history.length === 0) {
      onRecordTextChange((session.state === 'HANDOFF_READY'
        ? '用户侧没有适合自行执行的安全步骤，尚未修改设置。'
        : '尚未执行恢复操作。') + '\n' + currentText);
      return;
    }
    const records = session.history.map((record, index) => {
      const historyStep = plan.steps[record.stepIndex];
      const rollback = record.rollbackConfirmed ? '；已确认还原原设置' : '';
      return `${index + 1}. ${historyStep?.actionTitle || record.stepId}：${OUTCOME_LABELS[record.outcome]}${rollback}`
        + (historyStep ? `\n   操作：${historyStep.actionDetail}\n   预期：${historyStep.expectedObservation}` : '');
    }).join('\n');
    onRecordTextChange(`${records}\n${currentText}\n限制：用户反馈不会自动确认根因或提高结论等级。`);
  }, [onRecordTextChange, plan, session]);

  const record = (outcome: TroubleshootingOutcome) => {
    setSession(current => recordTroubleshootingOutcome(plan, current, outcome));
  };
  const continueFlow = () => setSession(current => continueTroubleshootingSession(current));
  const correctLast = () => setSession(current => correctLastTroubleshootingOutcome(current));
  const showRoleTasks = session.state === 'DIRECTION_SUPPORTED' || session.state === 'HANDOFF_READY';

  return (
    <div className="novice-troubleshooting-flow">
      <div className="novice-flow-intro">
        <section className="novice-troubleshooting-problem novice-flow-card">
          <div className="novice-flow-kicker"><ExclamationCircleOutlined /> 发生了什么</div>
          <h3>{headline?.title || step?.problemTitle || plan.fallbackProblemTitle}</h3>
          <p>{headline?.problem || step?.problemDetail || plan.fallbackProblemDetail}</p>
          {headline?.impact && <p>影响范围：{headline.impact}</p>}
          <Tag>{headline ? `${headline.kind === 'confirmed' ? '已确认事实' : headline.kind === 'highly-likely' ? '高度疑似' : headline.kind === 'needs-more-data' ? '需要补充采集' : '仅现象'} · ${headline.confidenceText}` : '尚无可展示结论'}</Tag>
        </section>
        <section className="novice-flow-card novice-flow-reason">
          <div className="novice-flow-kicker">为什么这样判断</div>
          <p>{headline?.reason || finalSummary.executiveSummary || plan.fallbackProblemDetail}</p>
          <div className="novice-flow-facts">
            <div><strong>支持证据</strong><span>{evidence ? `${evidence.label}：${evidence.value}` : '当前未提供可展示的关键证据'}</span></div>
            <div><strong>反证 / 限制</strong><span>{counterEvidence ? `${counterEvidence.label}：${counterEvidence.value}` : '未提供明确反证，不代表已排除其他原因'}</span></div>
            <div><strong>还缺什么</strong><span>{missing ? `${missing.title}：${missing.recommendation}` : '当前结论未列出特定缺失项，仍需按结果复核'}</span></div>
          </div>
          {(hasRequestLink || hasNetlogLink) && (
            <div className="novice-flow-evidence-links">
              {requestIds.length > 0 && onOpenHarRequests && <Button size="small" onClick={() => onOpenHarRequests(requestIds)}>查看关联请求</Button>}
              {(sourceIds.length > 0 || eventIds.length > 0) && onOpenNetlogEvidence && <Button size="small" onClick={() => onOpenNetlogEvidence(sourceIds, eventIds)}>查看 NetLog 证据</Button>}
            </div>
          )}
        </section>
      </div>

      {session.state === 'ACTION_PENDING' && step && (
        <section className="novice-troubleshooting-action novice-flow-card">
          <div className="novice-flow-kicker"><ThunderboltOutlined /> 现在先做这一件事</div>
          <h3>{step.actionTitle}</h3>
          <p>{step.actionDetail}</p>
          <div className="novice-flow-tags"><Tag>适用角色：普通用户 / 一线支持</Tag><Tag>{step.sourceAction.risk === 'needs-approval' ? '需遵守组织策略' : '低风险验证'}</Tag></div>
          <div className="novice-flow-action-grid">
            <div>
              <h4>具体怎么做</h4>
              <ol>{step.actionSteps.map((item, index) => <li key={`${step.id}-${index}`}>{item}</li>)}</ol>
            </div>
            <div className="novice-flow-observations">
              <div><strong>预期观察</strong><span>{step.expectedObservation}</span></div>
              <div><strong>没有改善时</strong><span>{step.sourceAction.nextIfFailed || '记录结果并继续下一步；没有安全步骤时转交专业人员。'}</span></div>
              <div><strong>回退方法</strong><span>{step.rollback || '此操作不要求修改系统设置；停止验证即可。'}</span></div>
            </div>
          </div>
          <Alert type="warning" showIcon message="操作前提" description={step.prerequisite} />
          <div className="novice-flow-outcomes">
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => record('improved')}>恢复正常了</Button>
            <Button onClick={() => record('unchanged')}>还是有问题</Button>
            <Button danger onClick={() => record('worse')}>变得更差</Button>
          </div>
        </section>
      )}

      {session.state === 'DIRECTION_SUPPORTED' && step && (
        <section className="novice-troubleshooting-success novice-flow-card">
          <div className="novice-flow-kicker"><CheckCircleOutlined /> 用户反馈：恢复正常</div>
          <h3>这个方向值得继续核验</h3>
          <p>执行“{step.actionTitle}”后恢复，只提高该方向的相关性，不会改变上面的结论等级或确认唯一根因。</p>
          <ResolutionBlock title="现在怎么继续使用" text={step.temporaryWorkaround} />
          <ResolutionBlock title="如何复核与彻底解决" text={step.permanentFix} />
          <p className="novice-flow-capture">建议保留恢复前后的时间与 HAR / NetLog 对照，交给相应人员复核。</p>
        </section>
      )}

      {session.state === 'ROLLBACK_REQUIRED' && step && (
        <section className="novice-troubleshooting-rollback novice-flow-card">
          <div className="novice-flow-kicker"><SafetyCertificateOutlined /> {lastRecord?.outcome === 'worse' ? '变差了，先还原' : '未恢复，先还原'}</div>
          <h3>{lastRecord?.outcome === 'worse' ? '先恢复原状态，再转交处理' : '先恢复原状态，再继续验证'}</h3>
          <p>{step.rollback}</p>
          <Button type="primary" onClick={continueFlow}>
            {session.pendingStepIndex === undefined ? '已恢复原设置，转交处理' : '已恢复原设置，继续定位'}
          </Button>
        </section>
      )}

      {session.state === 'NEXT_ACTION' && (
        <section className="novice-flow-card novice-flow-next">
          <div className="novice-flow-kicker">结果：仍有问题</div>
          <p>这条方向暂未得到支持。记录当前结果后，继续下一项安全验证。</p>
          <Button type="primary" onClick={continueFlow}>继续下一步定位</Button>
        </section>
      )}

      {session.state === 'HANDOFF_READY' && (
        <section className="novice-troubleshooting-handoff novice-flow-card">
          <div className="novice-flow-kicker"><UserOutlined /> 下一步：转交处理</div>
          <h3>用户侧暂时不用再改设置</h3>
          <p>当前没有更多适合自行执行的安全步骤。请把已尝试结果、证据和缺失信息复制给 IT / 客服。</p>
          {plan.fallbackCategory === 'server' && <p>若有官方服务公告，可先查看；支付、订单等操作请确认处理结果后再决定是否重试。</p>}
        </section>
      )}

      {showRoleTasks && roleTasks.length > 0 && (
        <RoleTasks title={session.state === 'DIRECTION_SUPPORTED' ? '建议交给对应角色继续核验' : '接下来由谁处理'} tasks={roleTasks} />
      )}

      <section className="novice-flow-history novice-flow-card" aria-label="尝试历史">
        <div className="novice-flow-kicker">尝试历史 <Tag>{session.history.length} 条</Tag></div>
        {session.history.length === 0 ? <p>尚未记录操作结果。</p> : (
          <ol>{session.history.map((item, index) => (
            <li key={`${item.stepId}-${index}`}>
              {plan.steps[item.stepIndex]?.actionTitle || item.stepId}：{OUTCOME_LABELS[item.outcome]}
              {item.rollbackConfirmed ? ' · 已确认还原' : ''}
              {index === session.history.length - 1 && <Button type="link" size="small" onClick={correctLast}>更正上次结果</Button>}
            </li>
          ))}</ol>
        )}
      </section>
    </div>
  );
};

const ResolutionBlock: React.FC<{ title: string; text: string }> = ({ title, text }) => (
  <div className="novice-troubleshooting-resolution"><strong>{title}</strong><span>{text}</span></div>
);

const RoleTasks: React.FC<{
  title: string;
  tasks: ReturnType<typeof getRelevantRoleTasks>;
}> = ({ title, tasks }) => (
  <section className="novice-flow-card novice-flow-role-tasks">
    <div className="novice-flow-kicker">{title}</div>
    {tasks.map(task => (
      <div className="novice-troubleshooting-role-task" key={`${task.role}-${task.action.id}`}>
        <strong>{task.roleTitle}：</strong>{task.action.title}。{task.action.detail}
      </div>
    ))}
  </section>
);

export default NoviceTroubleshootingFlow;
