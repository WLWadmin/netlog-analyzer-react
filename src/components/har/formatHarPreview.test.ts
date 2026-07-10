import { detectHarPreviewLanguage, formatHarPreviewSource } from './formatHarPreview';

describe('formatHarPreview', () => {
  it('detects source language from mime type, resource type and URL', () => {
    expect(detectHarPreviewLanguage('text/javascript', '', 'https://example.com/app')).toBe('javascript');
    expect(detectHarPreviewLanguage('', 'stylesheet', 'https://example.com/app')).toBe('css');
    expect(detectHarPreviewLanguage('', '', 'https://example.com/app.xml?x=1')).toBe('html');
    expect(detectHarPreviewLanguage('text/plain', 'xhr', 'https://example.com/api')).toBe('text');
  });

  it('beautifies minified JavaScript, CSS and HTML', async () => {
    const js = await formatHarPreviewSource('function test(){const x=1;return x;}', 'text/javascript', 'script', 'https://example.com/app.js');
    const css = await formatHarPreviewSource('.a{color:red}.b{display:none}', 'text/css', 'stylesheet', 'https://example.com/app.css');
    const html = await formatHarPreviewSource('<html><body><main>ok</main></body></html>', 'text/html', 'document', 'https://example.com/');

    expect(js.text).toContain('function test() {\n');
    expect(js.text).toContain('  const x = 1;');
    expect(css.text).toContain('.a {\n');
    expect(html.text).toContain('<html>\n<body>\n  <main>ok</main>');
  });

  it('keeps plain text unchanged', async () => {
    await expect(formatHarPreviewSource('plain response', 'text/plain', 'xhr', 'https://example.com/api')).resolves.toEqual({
      text: 'plain response',
      language: 'text',
      formatted: false,
      skippedReason: 'plain-text',
    });
  });

  it('skips exceptionally large source instead of blocking the page', async () => {
    const source = 'x'.repeat(4 * 1024 * 1024 + 1);
    await expect(formatHarPreviewSource(source, 'text/javascript', 'script', 'https://example.com/large.js')).resolves.toEqual({
      text: source,
      language: 'javascript',
      formatted: false,
      skippedReason: 'too-large',
    });
  });
});
