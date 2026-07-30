import type { ReactNode } from 'react';
import { traceFactDomId } from '../traceDiagnosisViewModel';

export const TraceNavigationError: React.FC<{ message?: string }> = ({ message }) => (
  message ? <p className="trace-navigation-error" role="alert">{message}</p> : null
);

export const TraceFactItem: React.FC<{
  factId: string;
  highlightedDomId?: string;
  children: ReactNode;
}> = ({ factId, highlightedDomId, children }) => {
  const id = traceFactDomId(factId);
  return <li className={id === highlightedDomId ? 'is-highlighted' : undefined} id={id} tabIndex={-1}>{children}</li>;
};
