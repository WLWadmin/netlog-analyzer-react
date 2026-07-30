import type {
  FormatCandidate,
  FormatResolution,
  ProbeVerdict,
} from './fileFormatTypes';

export function resolveFileFormat(verdicts: readonly ProbeVerdict[]): FormatResolution {
  const candidates = verdicts.filter(
    (verdict): verdict is FormatCandidate => (
      verdict.kind === 'definite-match' || verdict.kind === 'possible-match'
    ),
  );
  const definite = candidates.filter(
    (candidate): candidate is Extract<ProbeVerdict, { kind: 'definite-match' }> => (
      candidate.kind === 'definite-match'
    ),
  );

  if (definite.length === 1 && candidates.length === 1) {
    return {
      kind: 'recommended',
      candidate: definite[0],
    };
  }
  if (candidates.length > 0) {
    return {
      kind: 'needs-choice',
      candidates,
    };
  }
  return {
    kind: 'unsupported',
    evidenceCodes: verdicts.flatMap(verdict => verdict.evidenceCodes),
  };
}
