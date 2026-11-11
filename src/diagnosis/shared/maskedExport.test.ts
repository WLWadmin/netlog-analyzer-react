import {
  findSensitiveDataLeaks,
  maskEvidenceValue,
  maskUrl,
  sanitizeDiagnosisText,
  generateMaskedReport,
} from './maskedExport';
import type { DiagnosticCard } from './types';

it('restores the established diagnostic report without an extra address projection', () => {
  const privateText = 'https://private.example.test/account?token=FAKE_VALUE';
  const card: DiagnosticCard = {
    id: 'card-1', source: 'netlog', category: 'network-change', severity: 'warning',
    confidence: 'low', title: privateText, conclusion: privateText,
    scope: { type: 'global', summary: privateText },
    evidence: [{ label: privateText, value: privateText, source: 'netlog', detail: privateText, fieldPath: privateText }],
    actions: [{ role: 'it', title: privateText, detail: privateText, command: `curl "${privateText}"`, expectedResult: privateText }],
    limitations: [privateText],
    confidenceFactors: [{ label: privateText, detail: privateText, impact: 'neutral' }],
  };
  const before = JSON.stringify(card);
  const report = generateMaskedReport([card]);
  expect(report).toContain(privateText);
  expect(report).toContain(maskEvidenceValue(privateText));
  expect(report).not.toContain('host-1.invalid');
  expect(JSON.stringify(card)).toBe(before);
});

describe('shared sensitive data scanner', () => {
  it('detects fake query, authorization, cookie, body, source, args and local paths', () => {
    expect(findSensitiveDataLeaks('token=FAKE_TOKEN_VALUE')).toContain('sensitive-key-value');
    expect(findSensitiveDataLeaks('token: FAKE_TOKEN_VALUE')).toContain('sensitive-key-value');
    expect(findSensitiveDataLeaks('Authorization: FAKE_TOKEN_VALUE')).toContain('sensitive-key-value');
    expect(findSensitiveDataLeaks('Authorization: Bearer FAKE_TOKEN_VALUE')).toContain('authorization-token');
    expect(findSensitiveDataLeaks('cookie=session=FAKE_COOKIE_VALUE')).toContain('sensitive-key-value');
    expect(findSensitiveDataLeaks('Cookie: FAKE_COOKIE_VALUE')).toContain('sensitive-key-value');
    expect(findSensitiveDataLeaks('X-Api-Key: FAKE_API_KEY')).toContain('sensitive-key-value');
    expect(findSensitiveDataLeaks('request body')).toContain('raw-body');
    expect(findSensitiveDataLeaks('+86 138 0013 8000')).toContain('phone');
    expect(findSensitiveDataLeaks('sourceText: "const privateValue = 1"')).toContain('raw-source-or-args');
    expect(findSensitiveDataLeaks('args={"token":"FAKE"}')).toContain('raw-source-or-args');
    expect(findSensitiveDataLeaks('https://example.test/app.js?debug=private')).toContain('url-query');
    expect(findSensitiveDataLeaks('/Users/example/private/app.js')).toContain('local-path');
    expect(findSensitiveDataLeaks('C:\\Users\\example\\private\\app.js')).toContain('local-path');
  });

  it('preserves the established maskUrl behavior', () => {
    expect(maskUrl('https://example.test/path?token=FAKE_TOKEN_VALUE&debug=visible')).toBe(
      'https://example.test/path?token=FAKE***&debug=visible',
    );
    expect(maskUrl('not a url')).toBe('not a url');
  });

  it('preserves the established maskEvidenceValue behavior', () => {
    expect(maskEvidenceValue('https://example.test/app.js?debug=private')).toBe(
      'https://example.test/app.js?debug=private',
    );
    expect(maskEvidenceValue('/Users/example/private/app.js?token=FAKE_TOKEN_VALUE')).toBe(
      '/Users/example/private/app.js?token=***',
    );
    expect(maskEvidenceValue('Authorization=FAKE_TOKEN_VALUE')).toBe('Authorization=***');
  });

  it('strictly sanitizes all query strings and local paths for diagnosis text', () => {
    expect(sanitizeDiagnosisText('source=https://example.test/app.js?debug=private')).toBe(
      'source=https://example.test/app.js?[query masked]',
    );
    expect(sanitizeDiagnosisText('/Users/example/private/app.js?token=FAKE_TOKEN_VALUE')).toBe(
      '[local path masked]',
    );
    expect(sanitizeDiagnosisText('C:\\Users\\example\\private\\app.js')).toBe(
      '[local path masked]',
    );
    expect(sanitizeDiagnosisText('Authorization: FAKE_TOKEN_VALUE')).toBe('Authorization: ***');
    expect(sanitizeDiagnosisText('Cookie: FAKE_COOKIE_VALUE')).toBe('Cookie: ***');
    expect(findSensitiveDataLeaks(sanitizeDiagnosisText(
      '/Users/example/private/app.js?token=FAKE_TOKEN_VALUE',
    ))).toEqual([]);
  });
});
