import { useState } from 'react';
import type {
  TraceDiagnosisCardViewModel,
  TraceEvidenceTarget,
  TraceFactTarget,
} from '../traceDiagnosisViewModel';

interface Props {
  primary?: TraceDiagnosisCardViewModel;
  secondary: TraceDiagnosisCardViewModel[];
  observationOnlyMessage?: string;
  onNavigateFact: (target: TraceFactTarget) => void;
  onNavigateEvidence: (target: TraceEvidenceTarget) => void;
}

interface DiagnosisActionsProps {
  card: TraceDiagnosisCardViewModel;
  onNavigateFact: Props['onNavigateFact'];
  onNavigateEvidence: Props['onNavigateEvidence'];
}

const DiagnosisActions: React.FC<DiagnosisActionsProps> = ({
  card,
  onNavigateFact,
  onNavigateEvidence,
}) => {
  const factTarget = card.factTarget;
  const evidenceTarget = card.evidenceTarget;
  return (
    <div className="trace-diagnosis-actions">
      {factTarget ? (
      <button
        aria-label={`查看事实：${card.title}`}
        onClick={() => onNavigateFact(factTarget)}
        type="button"
      >
        定位相关事实
      </button>
    ) : null}
      {evidenceTarget ? (
      <button
        aria-label={`查看证据索引：${card.title}`}
        onClick={() => onNavigateEvidence(evidenceTarget)}
        type="button"
      >
        打开证据索引
      </button>
    ) : null}
    </div>
  );
};

const DiagnosisBasis: React.FC<{
  card: TraceDiagnosisCardViewModel;
}> = ({ card }) => {
  const [expanded, setExpanded] = useState(false);
  const contentId = `trace-diagnosis-basis-${card.id}`;

  return (
    <div className="trace-diagnosis-basis">
      <button
        aria-label={`${expanded ? '收起' : '查看'}判断依据：${card.title}`}
        aria-controls={contentId}
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
        type="button"
      >
        {expanded ? '收起判断依据' : '查看判断依据'}
      </button>
      {expanded ? (
        <div id={contentId}>
          <dl>
            <div><dt>规则</dt><dd><code>{card.ruleId}</code></dd></div>
            <div>
              <dt>证据索引</dt>
              <dd>
                {card.evidenceIds.length > 0
                  ? card.evidenceIds.map(id => <code key={id}>{id}</code>)
                  : '没有可用索引'}
              </dd>
            </div>
          </dl>
          {card.counterEvidence.length > 0 ? (
            <>
              <h3>反证</h3>
              <ul>{card.counterEvidence.map(item => <li key={item}>{item}</li>)}</ul>
            </>
          ) : null}
          {card.limitations.length > 0 ? (
            <>
              <h3>限制</h3>
              <ul>{card.limitations.map(item => <li key={item}>{item}</li>)}</ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

const PrimaryIncident: React.FC<{
  card: TraceDiagnosisCardViewModel;
  onNavigateFact: Props['onNavigateFact'];
  onNavigateEvidence: Props['onNavigateEvidence'];
}> = ({ card, onNavigateFact, onNavigateEvidence }) => (
  <article className={`trace-primary-incident is-severity-${card.severity}`}>
    <header className="trace-primary-incident-heading">
      <div>
        <span>首要问题</span>
        <h2>{card.title}</h2>
        <p>{card.conclusion}</p>
      </div>
      <div className="trace-incident-signals" aria-label="问题评估">
        <strong>{card.impactLabel}</strong>
        <span>{card.evidenceStrengthLabel}</span>
        <time>{card.timeWindowLabel}</time>
      </div>
    </header>

    <ol className="trace-diagnosis-axis" aria-label="诊断主轴">
      <li>
        <span>01</span>
        <div><strong>现象</strong><p>{card.summary}</p></div>
      </li>
      <li>
        <span>02</span>
        <div>
          <strong>关键证据</strong>
          {card.evidenceSummaries.length > 0 ? (
            <ul>
              {card.evidenceSummaries.map(item => <li key={item}>{item}</li>)}
            </ul>
          ) : (
            <p>当前没有可展示的事件摘要。</p>
          )}
        </div>
      </li>
      <li>
        <span>03</span>
        <div><strong>疑似原因</strong><p>{card.causeSummary}</p></div>
      </li>
      <li>
        <span>04</span>
        <div>
          <strong>优先行动</strong>
          {card.advice.length > 0 ? (
            <ol>{card.advice.map(item => <li key={item}>{item}</li>)}</ol>
          ) : (
            <p>先定位相关事实和时间窗口，再补充可验证证据。</p>
          )}
        </div>
      </li>
    </ol>

    <aside className="trace-impact-summary">
      <strong>用户影响</strong>
      <p>{card.impactSummary}</p>
    </aside>
    <DiagnosisActions
      card={card}
      onNavigateEvidence={onNavigateEvidence}
      onNavigateFact={onNavigateFact}
    />
    <DiagnosisBasis card={card} />
  </article>
);

const SecondaryDiagnosis: React.FC<{
  card: TraceDiagnosisCardViewModel;
  onNavigateFact: Props['onNavigateFact'];
  onNavigateEvidence: Props['onNavigateEvidence'];
}> = ({ card, onNavigateFact, onNavigateEvidence }) => (
  <article className={`trace-secondary-diagnosis is-severity-${card.severity}`}>
    <header>
      <div>
        <span>{card.severityLabel} · {card.evidenceStrengthLabel}</span>
        <h3>{card.title}</h3>
      </div>
      <time>{card.timeWindowLabel}</time>
    </header>
    <p>{card.summary}</p>
    {card.advice.length > 0 ? (
      <p className="trace-secondary-action"><strong>先做：</strong>{card.advice[0]}</p>
    ) : null}
    <DiagnosisActions
      card={card}
      onNavigateEvidence={onNavigateEvidence}
      onNavigateFact={onNavigateFact}
    />
    <DiagnosisBasis card={card} />
  </article>
);

const TraceConclusionTab: React.FC<Props> = ({
  primary,
  secondary,
  observationOnlyMessage,
  onNavigateFact,
  onNavigateEvidence,
}) => (
  <section
    aria-label="Trace 诊断结论"
    className="trace-conclusion"
    data-testid="trace-conclusion-tab"
  >
    <div className="trace-conclusion-heading">
      <span>DIAGNOSIS PRIORITY</span>
      <h2>优先结论</h2>
      <p>先处理影响最大且证据最充分的问题，再进入事实与证据复核。</p>
    </div>
    {observationOnlyMessage ? (
      <p className="trace-observation-notice" role="status">
        {observationOnlyMessage}
      </p>
    ) : null}
    {primary ? (
      <PrimaryIncident
        card={primary}
        onNavigateEvidence={onNavigateEvidence}
        onNavigateFact={onNavigateFact}
      />
    ) : null}
    {secondary.length > 0 ? (
      <section className="trace-secondary-section" aria-labelledby="trace-secondary-title">
        <div>
          <span>SECONDARY FINDINGS</span>
          <h2 id="trace-secondary-title">
            {primary ? '其他需要关注' : '已确认的现象'}
          </h2>
        </div>
        <div className="trace-secondary-list">
          {secondary.map(card => (
            <SecondaryDiagnosis
              card={card}
              key={card.id}
              onNavigateEvidence={onNavigateEvidence}
              onNavigateFact={onNavigateFact}
            />
          ))}
        </div>
      </section>
    ) : primary ? null : (
      <p className="trace-result-note">当前没有命中的诊断。</p>
    )}
  </section>
);

export default TraceConclusionTab;
