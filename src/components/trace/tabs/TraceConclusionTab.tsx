import type { TraceDiagnosisCardViewModel, TraceEvidenceTarget, TraceFactTarget } from '../traceDiagnosisViewModel';

interface Props {
  primary?: TraceDiagnosisCardViewModel;
  secondary: TraceDiagnosisCardViewModel[];
  observationOnlyMessage?: string;
  onNavigateFact: (target: TraceFactTarget) => void;
  onNavigateEvidence: (target: TraceEvidenceTarget) => void;
}

const DiagnosisCard: React.FC<{
  card: TraceDiagnosisCardViewModel;
  level: 'primary' | 'secondary';
  onNavigateFact: Props['onNavigateFact'];
  onNavigateEvidence: Props['onNavigateEvidence'];
}> = ({ card, level, onNavigateFact, onNavigateEvidence }) => {
  const factTarget = card.factTarget;
  const evidenceTarget = card.evidenceTarget;
  return (
    <article className={`trace-result-panel trace-diagnosis-card is-${level} is-severity-${card.severity}`}>
      <div className="trace-result-panel-heading">
        <div>
          <span>{level === 'primary' ? '主结论' : '次结论'} · {card.ruleId}</span>
          <h2>{card.title}</h2>
        </div>
        <div className="trace-diagnosis-meta">
          <strong>{card.severityLabel}</strong>
          <small>置信度：{card.confidenceLabel}</small>
        </div>
      </div>
      <p>{card.summary}</p>
      {card.evidenceIds.length > 0 && (
        <>
          <h3>关键证据</h3>
          <ul>{card.evidenceIds.map(id => <li key={id}>{id}</li>)}</ul>
        </>
      )}
      {card.counterEvidence.length > 0 && (
        <>
          <h3>反证</h3>
          <ul>{card.counterEvidence.map(item => <li key={item}>{item}</li>)}</ul>
        </>
      )}
      {card.limitations.length > 0 && (
        <>
          <h3>限制</h3>
          <ul>{card.limitations.map(item => <li key={item}>{item}</li>)}</ul>
        </>
      )}
      {card.advice.length > 0 && (
        <>
          <h3>下一步</h3>
          <ol>{card.advice.map(item => <li key={item}>{item}</li>)}</ol>
        </>
      )}
      <div className="trace-diagnosis-actions">
        {factTarget && (
          <button aria-label={`查看事实：${card.title}`} onClick={() => onNavigateFact(factTarget)} type="button">
            查看事实
          </button>
        )}
        {evidenceTarget && (
          <button
            aria-label={`查看证据索引：${card.title}`}
            onClick={() => onNavigateEvidence(evidenceTarget)}
            type="button"
          >
            查看证据索引
          </button>
        )}
      </div>
    </article>
  );
};

const TraceConclusionTab: React.FC<Props> = ({ primary, secondary, observationOnlyMessage, onNavigateFact, onNavigateEvidence }) => (
  <section aria-label="Trace 诊断结论" data-testid="trace-conclusion-tab">
    <h2>优先结论</h2>
    {observationOnlyMessage && <p className="trace-observation-notice" role="status">{observationOnlyMessage}</p>}
    {primary ? <div className="trace-conclusion-layout">
      <DiagnosisCard card={primary} level="primary" onNavigateEvidence={onNavigateEvidence} onNavigateFact={onNavigateFact} />
      {secondary.length > 0 && <div className="trace-secondary-diagnoses">{secondary.map(card => <DiagnosisCard card={card} key={card.id} level="secondary" onNavigateEvidence={onNavigateEvidence} onNavigateFact={onNavigateFact} />)}</div>}
    </div> : secondary.length > 0 ? <div className="trace-result-grid">{secondary.map(card => <DiagnosisCard card={card} key={card.id} level="secondary" onNavigateEvidence={onNavigateEvidence} onNavigateFact={onNavigateFact} />)}</div> : <p className="trace-result-note">当前没有命中的诊断。</p>}
  </section>
);

export default TraceConclusionTab;
