import { useState } from 'react';
import { Tooltip, message } from 'antd';
import { CopyOutlined, CheckOutlined } from '@ant-design/icons';

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

  const handleCopy = () => {
    if (!hasValue) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      message.success(`${label || '内容'} 已复制`);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span
        style={{
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          fontSize: 13,
          color: hasValue ? 'var(--text-primary)' : 'var(--text-muted)',
          wordBreak: 'break-all',
          flex: 1,
          minWidth: 0,
        }}
      >
        {hasValue ? text : emptyText}
      </span>
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
