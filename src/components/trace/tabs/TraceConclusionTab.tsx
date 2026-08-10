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
        查看相关记录
      </button>
    ) : null}
      {evidenceTarget ? (
      <button
        aria-label={`查看证据索引：${card.title}`}
        onClick={() => onNavigateEvidence(evidenceTarget)}
        type="button"
      >
        查看技术证据
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
        {expanded ? '收起开发者依据' : '给开发人员查看'}
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
  <article className={`trace-primary-incident is-attribution-${card.attributionStatus}`}>
    <header className="trace-primary-incident-heading">
      <div>
        <span>优先结论</span>
        <h2>{card.title}</h2>
        <p>{card.conclusion}</p>
      </div>
      <div className="trace-incident-signals" aria-label="问题评估">
        <strong>{card.impactLabel}</strong>
        <span>{card.evidenceStrengthLabel}</span>
        <time>{card.timeWindowLabel}</time>
      </div>
    </header>

    <section className="trace-attribution-verdict" aria-label="归因状态">
      <span>归因判断</span>
      <strong>{card.attributionLabel}</strong>
      <p>{card.attributionSummary}</p>
    </section>

    <div className="trace-diagnosis-guide">
      <section>
        <h3>这会带来什么影响</h3>
        <p>{card.impactSummary}</p>
      </section>
      <section>
        <h3>{card.causeLabel}</h3>
        <p>{card.causeSummary}</p>
      </section>
      <section>
          <h3>下一步怎么做</h3>
          {card.advice.length > 0 ? (
            <ol>{card.advice.map(item => <li key={item}>{item}</li>)}</ol>
          ) : (
            <p>{card.attributionStatus === 'confirmed'
              ? '先查看相关记录，再按结论处理并复测。'
              : '先查看无法确认的原因，再补充对应的录制信息。'}</p>
          )}
      </section>
    </div>

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
  <article className={`trace-secondary-diagnosis is-attribution-${card.attributionStatus}`}>
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
      <p>先确认原因是否已经找到，再按建议处理；技术证据留给开发人员复核。</p>
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
            {primary ? '其他需要关注' : '当前无法确认原因'}
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
