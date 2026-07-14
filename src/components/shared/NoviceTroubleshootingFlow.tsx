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
}

const ROLE_LABELS = {
  user: '客服 / 一线支持',
  it: 'IT / 网络管理员',
  frontend: '前端',
  backend: '后端',
};

const NoviceTroubleshootingFlow: React.FC<NoviceTroubleshootingFlowProps> = ({ finalSummary, onRecordTextChange }) => {
  const plan = useMemo(() => buildTroubleshootingPlan(finalSummary), [finalSummary]);
  const [session, setSession] = useState<TroubleshootingSession>(() => createTroubleshootingSession(plan));

  useEffect(() => {
    setSession(createTroubleshootingSession(plan));
  }, [plan]);

  const step = currentTroubleshootingStep(plan, session);
  const lastOutcome = session.history[session.history.length - 1]?.outcome;
  const roleTasks = getRelevantRoleTasks(plan, session);

  useEffect(() => {
    if (!onRecordTextChange) return;
    if (session.history.length === 0) {
      onRecordTextChange(session.state === 'HANDOFF_READY' ? '用户侧没有适合自行执行的安全步骤，尚未修改网络设置。' : '尚未执行恢复操作。');
      return;
    }
    const outcomeLabel: Record<TroubleshootingOutcome, string> = {
      improved: '恢复正常',
      unchanged: '仍有问题',
      worse: '情况变差',
    };
    onRecordTextChange(session.history.map((record, index) => {
      const historyStep = plan.steps.find(item => item.id === record.stepId);
      return `${index + 1}. ${historyStep?.actionTitle || record.stepId}：${outcomeLabel[record.outcome]}`;
    }).join('\n'));
  }, [onRecordTextChange, plan.steps, session.history, session.state]);

  const record = (outcome: TroubleshootingOutcome) => {
    setSession(current => recordTroubleshootingOutcome(plan, current, outcome));
  };

  const continueFlow = () => {
    setSession(current => continueTroubleshootingSession(current));
  };

  return (
    <div className="novice-troubleshooting-flow" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section className="novice-troubleshooting-problem" style={{ padding: 16, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-blue)', fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
          <ExclamationCircleOutlined />
          你现在遇到的问题
        </div>
        <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1.45 }}>
          {step?.problemTitle || plan.fallbackProblemTitle}
        </div>
        <div style={{ marginTop: 6, color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: 13 }}>
          {step?.problemDetail || plan.fallbackProblemDetail}
        </div>
      </section>

      {session.state === 'ACTION_PENDING' && step && (
        <section className="novice-troubleshooting-action" style={{ padding: 16, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--accent-yellow)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-yellow)', fontSize: 14, fontWeight: 900 }}>
              <ThunderboltOutlined />
              先做这一件事
            </div>
            <Tag style={{ margin: 0, border: 'none', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
              第 {session.currentStepIndex + 1} / {plan.steps.length} 步
            </Tag>
          </div>
          <div style={{ marginTop: 10, fontSize: 16, fontWeight: 900, color: 'var(--text-primary)' }}>
            {step.actionTitle}
          </div>
          <div style={{ marginTop: 6, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.7 }}>
            {step.actionDetail}
          </div>
          {step.safetyNotice && (
            <Alert type="warning" showIcon message="操作前注意" description={step.safetyNotice} style={{ marginTop: 10 }} />
          )}
          <div style={{ marginTop: 10, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.7 }}>
            完成后重新打开刚才失败或很慢的页面，然后选择实际结果：
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => record('improved')}>
              恢复正常了
            </Button>
            <Button onClick={() => record('unchanged')}>还是有问题</Button>
            <Button danger onClick={() => record('worse')}>变得更差</Button>
          </div>
        </section>
      )}

      {session.state === 'DIRECTION_SUPPORTED' && step && (
        <section className="novice-troubleshooting-success" style={{ padding: 16, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--accent-green)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-green)', fontSize: 16, fontWeight: 900 }}>
            <CheckCircleOutlined />
            已恢复，可以沿这个方向处理
          </div>
          <div style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.7 }}>
            执行“{step.actionTitle}”后恢复，说明这个方向与问题相关，但仅凭一次对比还不能确认唯一根因。
          </div>
          <ResolutionBlock title="现在怎么继续使用" text={step.temporaryWorkaround} />
          <ResolutionBlock title="如何彻底解决" text={step.permanentFix} />
          <RoleTasks
            title={`建议交给 ${step.permanentOwners.map(role => ROLE_LABELS[role]).join('、')} 处理`}
            tasks={roleTasks}
          />
        </section>
      )}

      {session.state === 'ROLLBACK_REQUIRED' && step && (
        <section className="novice-troubleshooting-rollback" style={{ padding: 16, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--accent-red)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-red)', fontSize: 16, fontWeight: 900 }}>
            <SafetyCertificateOutlined />
            {lastOutcome === 'worse' ? '先恢复原设置，停止这条排查方向' : '这一步没有恢复，先还原设置'}
          </div>
          <div style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.7 }}>
            {step.rollback}
          </div>
          <Button type="primary" style={{ marginTop: 12 }} onClick={continueFlow}>
            {session.pendingStepIndex === undefined ? '已恢复原设置，转交处理' : '已恢复原设置，继续定位'}
          </Button>
        </section>
      )}

      {session.state === 'NEXT_ACTION' && (
        <Alert
          type="info"
          showIcon
          message="这条方向暂未得到支持"
          description={<Button type="primary" style={{ marginTop: 8 }} onClick={continueFlow}>继续下一步定位</Button>}
        />
      )}

      {session.state === 'HANDOFF_READY' && (
        <section className="novice-troubleshooting-handoff" style={{ padding: 16, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--accent-blue)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-blue)', fontSize: 16, fontWeight: 900 }}>
            <UserOutlined />
            用户侧暂时不用再改设置
          </div>
          <div style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.7 }}>
            当前没有更多适合用户自行操作的安全步骤。请点击页面上方“复制给 IT / 客服”，连同已经尝试过的结果一起转交。
          </div>
          <RoleTasks title="接下来由专业角色处理" tasks={roleTasks} />
        </section>
      )}
    </div>
  );
};

const ResolutionBlock: React.FC<{ title: string; text: string }> = ({ title, text }) => (
  <div className="novice-troubleshooting-resolution" style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{title}</div>
    <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65 }}>{text}</div>
  </div>
);

const RoleTasks: React.FC<{
  title: string;
  tasks: ReturnType<typeof getRelevantRoleTasks>;
}> = ({ title, tasks }) => {
  if (tasks.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {tasks.map(task => (
          <div className="novice-troubleshooting-role-task" key={`${task.role}-${task.action.id}`} style={{ padding: '9px 11px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--text-primary)' }}>{task.roleTitle}：</strong>
            {task.action.title}。{task.action.detail}
          </div>
        ))}
      </div>
    </div>
  );
};

export default NoviceTroubleshootingFlow;
