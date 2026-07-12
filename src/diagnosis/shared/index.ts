/**
 * 统一诊断模型导出
 */

export type {
  DiagnosticSource,
  DiagnosticCategory,
  DiagnosticRole,
  DiagnosticScopeType,
  DiagnosticScope,
  DiagnosticEvidence,
  DiagnosticAction,
  DiagnosticNavigationTarget,
  DiagnosticCard,
  CollectionQuality,
  DiagnosisSummary,
} from './types';

export type {
  FinalDiagnosisMode,
  FinalConclusionKind,
  FinalConclusionSource,
  FinalDiagnosisSummary,
  FinalConclusion,
  RootCauseCluster,
  ActionGroup,
  FinalAction,
  FinalEvidence,
  MissingInfoItem,
} from './finalSummaryTypes';

export {
  buildFinalDiagnosisSummary,
} from './finalSummaryBuilder';

export {
  harDiagnosisToCards,
  checkHarQuality,
  buildHarDiagnosisSummary,
} from './fromHar';

export {
  netlogToCards,
  checkNetlogQuality,
  buildNetlogDiagnosisSummary,
} from './fromNetlog';

export {
  COMMAND_LIBRARY,
  getCommandsForCategory,
  getCommandsForRole,
  getGroupedCommands,
} from './commandLibrary';

export type { TroubleshootingCommand } from './commandLibrary';

export {
  maskUrl,
  maskHeader,
  maskEvidenceValue,
  generateMaskedReport,
} from './maskedExport';

export {
  buildHarNavigationTarget,
  buildNetlogNavigationTarget,
} from './navigation';

export {
  combinedDiagnosisToCards,
  checkCombinedQuality,
  buildCombinedDiagnosisSummary,
} from './fromCombined';

export {
  compareBaselines,
  buildBaselineCompareSummary,
} from './baselineComparator';

export {
  compareNetlogBaselines,
} from './netlogBaselineComparator';

export {
  parseBaselineNetlogFile,
} from './baselineNetlogUpload';

export {
  compareCombinedBaselines,
} from './combinedBaselineComparator';

export type {
  CombinedBaselineInput,
} from './combinedBaselineComparator';

export {
  buildDiagnosisReleaseGateReport,
} from './diagnosisReleaseGate';

export type {
  DiagnosisPerformanceMetrics,
  DiagnosisReleaseGateInput,
  DiagnosisReleaseGateReport,
  GoldenCorpusCaseResult,
  ProductAcceptanceMetrics,
} from './diagnosisReleaseGate';

export {
  buildHarIssueClusters,
  getHarEvidenceLevelLabel,
  getHarRoleLabel,
} from './harIssueClusters';

export type {
  HarIssueCategory,
  HarEvidenceLevel,
  HarIssueCluster,
} from './harIssueClusters';

export {
  buildHarNoviceDiagnosis,
} from './harNoviceDiagnosis';

export type {
  HarNoviceDiagnosis,
} from './harNoviceDiagnosis';

export {
  buildHarObservations,
  buildNetlogObservations,
} from './diagnosisObservation';

export type {
  DiagnosisEvidenceLevel,
  DiagnosisObservation,
} from './diagnosisObservation';

export {
  calculateCombinedDiagnosisCoverage,
  calculateHarDiagnosisCoverage,
  calculateNetlogDiagnosisCoverage,
} from './diagnosisCoverage';

export type {
  DiagnosisCoverage,
} from './diagnosisCoverage';

export {
  correlateHarRequestToNetlog,
  correlateHarRequestsToNetlog,
  summarizeRequestCorrelations,
} from './requestCorrelation';

export type {
  CorrelationLevel,
  RequestCorrelation,
} from './requestCorrelation';

export {
  buildTimeAlignmentContext,
  netlogTimeToEpochMs,
} from './timeAlignment';

export type {
  TimeAlignmentContext,
} from './timeAlignment';

export {
  applyEvidenceFusion,
  fuseDiagnosisEvidence,
} from './evidenceFusion';

export type {
  EvidenceFusionResult,
} from './evidenceFusion';

export {
  buildIncidentEpisodes,
} from './incidentEpisode';

export type {
  IncidentEpisode,
  IncidentRecoveryState,
} from './incidentEpisode';

export {
  buildIncidentNarrative,
} from './incidentNarrative';

export {
  calculateImpactScope,
} from './impactScope';

export type {
  ImpactScopeResult,
} from './impactScope';

export {
  getHarRequestImportance,
  getNetlogRequestImportance,
  summarizeRequestImportance,
} from './requestImportance';

export type {
  RequestImportance,
  RequestImportanceLevel,
} from './requestImportance';

export {
  enrichActionsWithPlaybook,
  getPlaybookActions,
} from './actionPlaybook';

export type {
  PlaybookAction,
} from './actionPlaybook';

export {
  evaluateVerificationSession,
} from './verificationSession';

export type {
  VerificationNextStep,
  VerificationOutcome,
  VerificationRecord,
} from './verificationSession';
