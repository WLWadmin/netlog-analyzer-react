import { decodeHarResponseBody, sanitizeHarHtmlForPreview } from './decodeHarResponseBody';

describe('decodeHarResponseBody', () => {
  it('decodes base64 JSON text', () => {
    const text = btoa('{"ok":true}');
    const decoded = decodeHarResponseBody({
      state: 'available',
      text,
      encoding: 'base64',
      mimeType: 'application/json',
      originalLength: text.length,
    });

    expect(decoded.text).toBe('{"ok":true}');
    expect(decoded.isBase64).toBe(true);
    expect(decoded.isJson).toBe(true);
    expect(decoded.parsed).toEqual({ ok: true });
  });

  it('reports invalid base64 without throwing', () => {
    const decoded = decodeHarResponseBody({
      state: 'available',
      text: '%%%invalid%%%',
      encoding: 'base64',
      mimeType: 'text/plain',
      originalLength: 13,
    });

    expect(decoded.decodeError).toBe('base64 解码失败');
    expect(decoded.text).toBe('%%%invalid%%%');
  });

  it('creates data url for base64 images', () => {
    const decoded = decodeHarResponseBody({
      state: 'available',
      text: 'iVBORw0KGgo=',
      encoding: 'base64',
      mimeType: 'image/png',
      originalLength: 12,
    });

    expect(decoded.isImage).toBe(true);
    expect(decoded.dataUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('keeps base64 protobuf as binary instead of decoding it as text', () => {
    const decoded = decodeHarResponseBody({
      state: 'available',
      text: btoa('\u0001\u0002\u0003'),
      encoding: 'base64',
      mimeType: 'application/x-protobuf',
      originalLength: 4,
    });

    expect(decoded.isText).toBe(false);
    expect(decoded.isBinary).toBe(true);
    expect(decoded.text).toBeUndefined();
    expect(decoded.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('sanitizeHarHtmlForPreview', () => {
  it('removes active content and external navigation attributes', () => {
    const html = sanitizeHarHtmlForPreview(`
      <html>
        <head><meta http-equiv="refresh" content="0;url=https://evil.test"></head>
        <body>
          <script>alert(1)</script>
          <img src="https://evil.test/x.png" onerror="alert(1)">
          <a href="https://evil.test">go</a>
          <a href="data:text/html,unsafe">data link</a>
          <img src="data:image/png;base64,AAAA">
          <form action="https://evil.test"><button>send</button></form>
        </body>
      </html>
    `);

    expect(html).toContain('Content-Security-Policy');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('https://evil.test');
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).not.toContain('data:text/html,unsafe');
    expect(html).toContain('data:image/png;base64,AAAA');
  });
});
