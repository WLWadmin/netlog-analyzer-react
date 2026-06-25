import React from 'react';

interface HighlightedTextProps {
  text: string;
  keyword?: string;
  /**
   * 高亮样式
   * 默认使用淡黄色背景，避免与 error/success 色系冲突
   */
  highlightStyle?: React.CSSProperties;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 轻量高亮组件：对 text 中出现的 keyword 做 case-insensitive 高亮。
 * 注意：只用于展示层，不改变原始字符串内容。
 */
const HighlightedText: React.FC<HighlightedTextProps> = ({ text, keyword, highlightStyle }) => {
  const kw = (keyword || '').trim();
  if (!kw) return <>{text}</>;

  const reg = new RegExp(escapeRegExp(kw), 'ig');
  const parts = text.split(reg);
  const matches = text.match(reg) || [];

  if (parts.length <= 1) return <>{text}</>;

  const style: React.CSSProperties = highlightStyle || {
    background: 'rgba(251, 191, 36, 0.25)',
    border: '1px solid rgba(251, 191, 36, 0.35)',
    borderRadius: 4,
    padding: '0 2px',
  };

  return (
    <>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {p}
          {i < matches.length && <mark style={style}>{matches[i]}</mark>}
        </React.Fragment>
      ))}
    </>
  );
};

export default HighlightedText;

