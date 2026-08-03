import { useEffect, useState, type ReactNode } from 'react';
import { useNavigation } from '../../../contexts/NavigationContext';
import type { TraceTab } from '../../../utils/hashRouting';
import { traceFactDomId } from '../traceDiagnosisViewModel';

export const TraceNavigationError: React.FC<{ message?: string }> = ({ message }) => (
  message ? <p className="trace-navigation-error" role="alert">{message}</p> : null
);

export function usePinnedTraceFactId(tab: TraceTab): string | undefined {
  const { intent } = useNavigation();
  const targetId = intent?.fileType === 'trace'
    && intent.tab === tab
    && intent.scrollTo?.type === 'fact'
    ? String(intent.scrollTo.id)
    : undefined;
  const [pinnedId, setPinnedId] = useState<string>();
  useEffect(() => {
    if (targetId) setPinnedId(targetId);
  }, [targetId]);
  return targetId ?? pinnedId;
}

export const TraceFactItem: React.FC<{
  factId: string;
  highlightedDomId?: string;
  children: ReactNode;
}> = ({ factId, highlightedDomId, children }) => {
  const id = traceFactDomId(factId);
  return <li className={id === highlightedDomId ? 'is-highlighted' : undefined} id={id} tabIndex={-1}>{children}</li>;
};

export const TraceFactTableRow: React.FC<{
  factId: string;
  highlightedDomId?: string;
  children: ReactNode;
  testId?: string;
}> = ({ factId, highlightedDomId, children, testId }) => {
  const id = traceFactDomId(factId);
  return (
    <tr
      className={id === highlightedDomId ? 'is-highlighted' : undefined}
      data-testid={testId}
      id={id}
      tabIndex={-1}
    >
      {children}
    </tr>
  );
};

export const TraceFactsSectionHeading: React.FC<{
  eyebrow: string;
  title: string;
  description?: string;
}> = ({ eyebrow, title, description }) => (
  <header className="trace-facts-section-heading">
    <span>{eyebrow}</span>
    <h2>{title}</h2>
    {description ? <p>{description}</p> : null}
  </header>
);

export const TraceSummaryGrid: React.FC<{
  items: Array<{ label: string; value: string; tone?: 'critical' | 'caution' | 'neutral' }>;
}> = ({ items }) => (
  <dl className="trace-summary-grid">
    {items.map(item => (
      <div className={item.tone ? `is-${item.tone}` : undefined} key={item.label}>
        <dt>{item.label}</dt>
        <dd>{item.value}</dd>
      </div>
    ))}
  </dl>
);

export const TraceExpertDisclosure: React.FC<{
  label: string;
  children: ReactNode;
}> = ({ label, children }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="trace-expert-disclosure">
      <button
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
        type="button"
      >
        {expanded ? `收起${label}` : `展开${label}`}
      </button>
      {expanded ? <div className="trace-expert-content">{children}</div> : null}
    </section>
  );
};
