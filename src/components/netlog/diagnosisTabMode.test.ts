import { shouldBuildLegacyDiagnosisData } from './diagnosisTabMode';

describe('diagnosisTabMode', () => {
  it('expert-report 模式不构建 legacy diagnosis data', () => {
    expect(shouldBuildLegacyDiagnosisData('expert-report')).toBe(false);
  });

  it('full-legacy 模式保留 legacy diagnosis data', () => {
    expect(shouldBuildLegacyDiagnosisData('full-legacy')).toBe(true);
  });
});
