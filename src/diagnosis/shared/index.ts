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
