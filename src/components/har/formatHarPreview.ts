export type HarPreviewLanguage = 'javascript' | 'css' | 'html' | 'text';

export interface HarPreviewFormatResult {
  text: string;
  language: HarPreviewLanguage;
  formatted: boolean;
  skippedReason?: 'too-large' | 'plain-text' | 'format-error';
}

const MAX_FORMAT_SOURCE_LENGTH = 4 * 1024 * 1024;

export function detectHarPreviewLanguage(mimeType: string, rawType: string, url: string): HarPreviewLanguage {
  const mime = mimeType.toLowerCase();
  const type = rawType.toLowerCase();
  let pathname = url.toLowerCase();
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    // Keep the raw URL fallback.
  }

  if (mime.includes('javascript') || mime.includes('ecmascript') || type === 'script' || type === 'js' || pathname.endsWith('.js') || pathname.endsWith('.mjs')) {
    return 'javascript';
  }
  if (mime.includes('css') || type === 'stylesheet' || type === 'css' || pathname.endsWith('.css')) return 'css';
  if (mime.includes('html') || mime.includes('xml') || type === 'document' || type === 'doc' || pathname.endsWith('.html') || pathname.endsWith('.xml')) {
    return 'html';
  }
  return 'text';
}

export async function formatHarPreviewSource(
  source: string,
  mimeType: string,
  rawType: string,
  url: string,
): Promise<HarPreviewFormatResult> {
  const language = detectHarPreviewLanguage(mimeType, rawType, url);
  if (language === 'text') return { text: source, language, formatted: false, skippedReason: 'plain-text' };
  if (source.length > MAX_FORMAT_SOURCE_LENGTH) return { text: source, language, formatted: false, skippedReason: 'too-large' };

  try {
    const imported = await import('js-beautify');
    const beautify = (('default' in imported ? imported.default : imported) as unknown) as {
      js: (value: string, options: Record<string, unknown>) => string;
      css: (value: string, options: Record<string, unknown>) => string;
      html: (value: string, options: Record<string, unknown>) => string;
    };
    const options = {
      indent_size: 2,
      preserve_newlines: true,
      max_preserve_newlines: 2,
      wrap_line_length: 0,
      end_with_newline: false,
    };
    const formattedText = language === 'javascript'
      ? beautify.js(source, options)
      : language === 'css'
        ? beautify.css(source, options)
        : beautify.html(source, { ...options, extra_liners: [] });

    return {
      text: formattedText,
      language,
      formatted: formattedText !== source,
    };
  } catch {
    return { text: source, language, formatted: false, skippedReason: 'format-error' };
  }
}
