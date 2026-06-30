export type DiagnosisTabMode = 'full-legacy' | 'expert-report';

export function shouldBuildLegacyDiagnosisData(mode: DiagnosisTabMode): boolean {
  return mode !== 'expert-report';
}
