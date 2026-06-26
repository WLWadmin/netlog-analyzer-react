import { useState } from 'react';
import { Tooltip, message } from 'antd';
import { CopyOutlined, CheckOutlined } from '@ant-design/icons';
import { copyText } from '../../utils/copyText';

interface CopyTextProps {
  text: string;
  label?: string;
  mono?: boolean;
  emptyText?: string;
}

// 可一键复制的字段展示组件
const CopyText: React.FC<CopyTextProps> = ({ text, label, mono = true, emptyText = '-' }) => {
  const [copied, setCopied] = useState(false);
  const hasValue = text !== undefined && text !== null && text !== '' && text !== '-';
  const shouldTooltip = hasValue && text.length > 100;

  const handleCopy = async () => {
    if (!hasValue) return;
    try {
      await copyText(text);
      setCopied(true);
      message.success(`${label || '内容'} 已复制`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      message.error('复制失败，请手动选择内容复制');
    }
  };

  const textSpan = (
    <span
      style={{
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
        fontSize: 13,
        color: hasValue ? 'var(--text-primary)' : 'var(--text-muted)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1,
        minWidth: 0,
      }}
    >
      {hasValue ? text : emptyText}
    </span>
  );

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {shouldTooltip ? (
        <Tooltip
          title={text}
          placement="topLeft"
          styles={{
            root: { maxWidth: 1000 },
            container: {
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              padding: '10px 14px',
              borderRadius: 8,
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              wordBreak: 'break-all',
              lineHeight: 1.5,
            },
          }}
        >
          {textSpan}
        </Tooltip>
      ) : (
        textSpan
      )}
      {hasValue && (
        <Tooltip title={copied ? '已复制' : '复制'}>
          <span
            onClick={handleCopy}
            style={{
              cursor: 'pointer',
              color: copied ? 'var(--accent-green)' : 'var(--accent-blue)',
              fontSize: 13,
              flexShrink: 0,
              padding: '2px 4px',
            }}
          >
            {copied ? <CheckOutlined /> : <CopyOutlined />}
          </span>
        </Tooltip>
      )}
    </div>
  );
};

export default CopyText;
