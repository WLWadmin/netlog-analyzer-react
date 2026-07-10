import { useEffect, useMemo, useState } from 'react';
import { Button, Tag } from 'antd';
import { detectHarPreviewLanguage, formatHarPreviewSource, type HarPreviewFormatResult } from './formatHarPreview';

interface HarCodeViewerProps {
  source: string;
  mimeType: string;
  rawType: string;
  url: string;
  format?: boolean;
  maxHeight?: number;
}

const MAX_RENDERED_LINES = 10000;

const LANGUAGE_LABELS = {
  javascript: 'JavaScript',
  css: 'CSS',
  html: 'HTML / XML',
  text: 'Text',
};

const HarCodeViewer: React.FC<HarCodeViewerProps> = ({ source, mimeType, rawType, url, format = true, maxHeight = 520 }) => {
  const language = useMemo(() => detectHarPreviewLanguage(mimeType, rawType, url), [mimeType, rawType, url]);
  const [wrap, setWrap] = useState(false);
  const [result, setResult] = useState<HarPreviewFormatResult>({ text: source, language, formatted: false });
  const [formatting, setFormatting] = useState(format && language !== 'text');

  useEffect(() => {
    let cancelled = false;
    setResult({ text: source, language, formatted: false });
    if (!format || language === 'text') {
      setFormatting(false);
      return () => { cancelled = true; };
    }

    setFormatting(true);
    formatHarPreviewSource(source, mimeType, rawType, url).then(next => {
      if (!cancelled) {
        setResult(next);
        setFormatting(false);
      }
    });
    return () => { cancelled = true; };
  }, [format, language, mimeType, rawType, source, url]);

  const rendered = useMemo(() => {
    const lines = result.text.split('\n');
    if (lines.length <= MAX_RENDERED_LINES) return { text: result.text, lineCount: lines.length, truncated: false };
    return {
      text: `${lines.slice(0, MAX_RENDERED_LINES).join('\n')}\n/* Preview truncated: use Response to inspect the original content. */`,
      lineCount: MAX_RENDERED_LINES + 1,
      truncated: true,
    };
  }, [result.text]);

  const lineNumbers = useMemo(
    () => Array.from({ length: rendered.lineCount }, (_, index) => String(index + 1)).join('\n'),
    [rendered.lineCount],
  );

  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-surface)', overflow: 'hidden' }}>
      <div
        style={{
          minHeight: 36,
          padding: '5px 8px 5px 12px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          background: 'var(--bg-elevated)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{LANGUAGE_LABELS[language]}</span>
          {formatting && <Tag style={{ margin: 0 }}>格式化中...</Tag>}
          {!formatting && result.formatted && <Tag color="blue" style={{ margin: 0 }}>已格式化</Tag>}
          {result.skippedReason === 'too-large' && <Tag color="orange" style={{ margin: 0 }}>内容过大，显示原文</Tag>}
          {rendered.truncated && <Tag color="orange" style={{ margin: 0 }}>仅显示前 {MAX_RENDERED_LINES} 行</Tag>}
        </div>
        <Button size="small" type="text" onClick={() => setWrap(value => !value)}>
          {wrap ? '取消换行' : '自动换行'}
        </Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch', maxHeight, overflow: 'auto' }}>
        {!wrap && (
          <pre
            aria-hidden="true"
            style={{
              position: 'sticky',
              left: 0,
              zIndex: 1,
              flex: '0 0 auto',
              minWidth: 48,
              margin: 0,
              padding: '10px 10px 10px 8px',
              borderRight: '1px solid var(--border-color)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-disabled)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              lineHeight: 1.65,
              textAlign: 'right',
              userSelect: 'none',
            }}
          >
            {lineNumbers}
          </pre>
        )}
        <pre
          aria-label={`${LANGUAGE_LABELS[language]} source preview`}
          style={{
            flex: '0 0 auto',
            minWidth: wrap ? '100%' : 'calc(100% - 48px)',
            margin: 0,
            padding: 10,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12.5,
            lineHeight: 1.65,
            whiteSpace: wrap ? 'pre-wrap' : 'pre',
            overflowWrap: wrap ? 'anywhere' : 'normal',
            tabSize: 2,
          }}
        >
          {rendered.text}
        </pre>
      </div>
    </div>
  );
};

export default HarCodeViewer;
