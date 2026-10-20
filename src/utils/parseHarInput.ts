import { parseHar, type HarAnalysisResult } from '../harParser';
import { harRepairInfo, parseHarWithRepair, type HarRepairInfo } from './harRepair';

/** Shared Worker/fallback contract. rawData is the exact array parsed for IDs. */
export function parseHarInput(
  input: unknown,
  suppliedRepairInfo?: HarRepairInfo,
  onProgress?: (completed: number, total: number) => void,
): { result: HarAnalysisResult; rawData: unknown } {
  const recovery = typeof input === 'string' ? parseHarWithRepair(input) : undefined;
  const rawData = recovery ? recovery.data : input;
  const info = recovery?.repaired ? harRepairInfo(recovery) : suppliedRepairInfo;
  const result = onProgress ? parseHar(rawData, onProgress) : parseHar(rawData);
  if (info) {
    // Explicit projection also removes an old caller's accidental `data` field.
    result.repairInfo = {
      repaired: info.repaired,
      recoveredEntries: info.recoveredEntries,
      totalEntries: info.totalEntries,
      droppedEntries: info.droppedEntries,
      recoveryRate: info.recoveryRate,
      reason: info.reason,
      warnings: info.warnings,
      ...(info.totalEntriesExact === undefined ? {} : { totalEntriesExact: info.totalEntriesExact }),
      ...(info.structureIncompleteEntries === undefined ? {} : { structureIncompleteEntries: info.structureIncompleteEntries }),
      ...(info.syntaxDamagedEntries === undefined ? {} : { syntaxDamagedEntries: info.syntaxDamagedEntries }),
      ...(info.unknownRanges === undefined ? {} : { unknownRanges: info.unknownRanges }),
      ...(info.heuristicResynchronization === undefined ? {} : { heuristicResynchronization: info.heuristicResynchronization }),
      ...(info.retainedSources ? { retainedSources: info.retainedSources } : {}),
      ...(info.excludedEntries ? { excludedEntries: info.excludedEntries } : {}),
    };
    info.retainedSources?.forEach((source, index) => {
      if (result.entries[index]) result.entries[index].sourceLocation = source;
    });
  }
  return { result, rawData };
}
