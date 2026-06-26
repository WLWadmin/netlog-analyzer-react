import type {
  DiagnosticCard,
  DiagnosticCategory,
  DiagnosticConfidenceLevel,
  DiagnosticEvidence,
  DiagnosticRole,
} from './types';

export type FinalDiagnosisMode = 'har' | 'netlog' | 'combined';

export type FinalConclusionKind =
  | 'confirmed'
  | 'highly-likely'
  | 'symptom-only'
  | 'needs-more-data';

export type FinalConclusionSource =
  | 'har'
  | 'netlog'
  | 'combined'
  | 'derived';

export interface FinalDiagnosisSummary {
  mode: FinalDiagnosisMode;
  status: 'has-conclusion' | 'limited-conclusion' | 'insufficient-data';
  headline: FinalConclusion[];
  rootCauseClusters: RootCauseCluster[];
  actionPlan: ActionGroup[];
  missingInfo: MissingInfoItem[];
  expertCards: DiagnosticCard[];
  executiveSummary: string;
  fallbackReason?: string;
}

export interface FinalConclusion {
  id: string;
  kind: FinalConclusionKind;
  source: FinalConclusionSource;
  category: DiagnosticCategory;
  title: string;
  problem: string;
  reason: string;
  impact: string;
  confidence: DiagnosticConfidenceLevel;
  confidenceText: string;
  primaryAction?: FinalAction;
  keyEvidence: FinalEvidence[];
  missingInfo: MissingInfoItem[];
  relatedCardIds: string[];
  score: number;
  displayRank: number;
  userFacingSummary: string;
}

export interface RootCauseCluster {
  id: string;
  category: DiagnosticCategory;
  title: string;
  kind: FinalConclusionKind;
  summary: string;
  cards: DiagnosticCard[];
  keyEvidence: FinalEvidence[];
  actions: FinalAction[];
  affectedRequestCount: number;
  affectedDomainCount: number;
  confidence: DiagnosticConfidenceLevel;
  score: number;
}

export interface ActionGroup {
  role: DiagnosticRole | 'collect';
  title: string;
  actions: FinalAction[];
  priority: number;
}

export interface FinalAction {
  id: string;
  title: string;
  detail: string;
  command?: string;
  expectedResult?: string;
  nextIfFailed?: string;
  sourceCardId?: string;
  priority: number;
  effort?: 'low' | 'medium' | 'high';
  risk?: 'safe' | 'needs-approval' | 'sensitive';
}

export interface FinalEvidence {
  label: string;
  value: string;
  source: DiagnosticEvidence['source'];
  originalSource?: DiagnosticEvidence['originalSource'];
  detail?: string;
  requestIds?: number[];
  eventIds?: string[];
}

export interface MissingInfoItem {
  id: string;
  title: string;
  reason: string;
  recommendation: string;
  detailGroups?: Array<{
    title: string;
    items: string[];
  }>;
  sensitivity?: 'low' | 'medium' | 'high';
  optional?: boolean;
}
