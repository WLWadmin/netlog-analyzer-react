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
