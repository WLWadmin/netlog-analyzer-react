import type { HarResponseBodyPayload } from '../../workers/protocols';

export interface DecodedHarBody {
  text?: string;
  bytes?: Uint8Array;
  mimeType: string;
  charset?: string;
  isBase64: boolean;
  isText: boolean;
  isBinary: boolean;
  isJson: boolean;
  isImage: boolean;
  isMedia: boolean;
  dataUrl?: string;
  parsed?: unknown;
  decodeError?: string;
}

function isTextMime(mimeType: string): boolean {
  const lower = mimeType.toLowerCase();
  return lower.startsWith('text/')
    || lower.includes('json')
    || lower.includes('javascript')
    || lower.includes('xml')
    || lower.includes('html')
    || lower.includes('css');
}

function isBinaryMime(mimeType: string): boolean {
  const lower = mimeType.toLowerCase();
  return lower.includes('octet-stream')
    || lower.includes('protobuf')
    || lower.includes('application/wasm')
    || lower.includes('font/')
    || lower.includes('woff');
}

function extractCharset(mimeType: string): string | undefined {
  const match = mimeType.match(/charset=([^;\s]+)/i);
  return match?.[1];
}

function decodeBase64(text: string): Uint8Array {
  const binary = typeof window !== 'undefined' && window.atob ? window.atob(text) : globalThis.atob(text);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function decodeText(bytes: Uint8Array, charset?: string): string {
  if (typeof TextDecoder === 'undefined') {
    return Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export function decodeHarResponseBody(payload: HarResponseBodyPayload): DecodedHarBody {
  const mimeType = payload.mimeType || '';
  const lower = mimeType.toLowerCase();
  const charset = extractCharset(mimeType);
  const isBase64 = payload.encoding.toLowerCase() === 'base64';
  const isImage = lower.startsWith('image/');
  const isMedia = lower.startsWith('video/') || lower.startsWith('audio/');
  const isText = isTextMime(mimeType)
    || (!isBase64 && !isBinaryMime(mimeType) && !isImage && !isMedia);

  let text = payload.text || '';
  let bytes: Uint8Array | undefined;
  let decodeError: string | undefined;

  if (isBase64 && text) {
    try {
      bytes = decodeBase64(text);
      if (isText) text = decodeText(bytes, charset);
    } catch {
      decodeError = 'base64 解码失败';
    }
  }

  const decoded: DecodedHarBody = {
    text: isText ? text : undefined,
    bytes,
    mimeType,
    charset,
    isBase64,
    isText,
    isBinary: !isText,
    isJson: false,
    isImage,
    isMedia,
    decodeError,
  };

  if ((isImage || isMedia) && text) {
    decoded.dataUrl = isBase64 ? `data:${mimeType};base64,${payload.text}` : text.startsWith('data:') ? text : undefined;
  }

  if (decoded.text) {
    try {
      decoded.parsed = JSON.parse(decoded.text);
      decoded.isJson = true;
    } catch {
      decoded.isJson = false;
    }
  }

  return decoded;
}

export function sanitizeHarHtmlForPreview(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, base').forEach(node => node.remove());
  doc.querySelectorAll('meta[http-equiv]').forEach(node => {
    if ((node.getAttribute('http-equiv') || '').toLowerCase() === 'refresh') node.remove();
  });
  doc.querySelectorAll('*').forEach(element => {
    Array.from(element.attributes).forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = attr.value || '';
      if (name.startsWith('on')) {
        element.removeAttribute(attr.name);
        return;
      }
      if (['href', 'srcset', 'action', 'formaction'].includes(name)) {
        element.removeAttribute(attr.name);
        return;
      }
      if (['src', 'poster'].includes(name) && !/^data:/i.test(value) && !/^blob:/i.test(value)) {
        element.removeAttribute(attr.name);
      }
    });
  });
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline';"></head><body>${doc.body.innerHTML}</body></html>`;
}
