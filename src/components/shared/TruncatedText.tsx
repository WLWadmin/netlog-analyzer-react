import React, { useState } from 'react';
import { Tooltip } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { copyText } from '../../utils/copyText';

interface TruncatedTextProps {
  text?: string | number | null;
  emptyText?: React.ReactNode;
  maxWidth?: number | string;
  copyable?: boolean;
  mono?: boolean;
  tooltipThreshold?: number;
  style?: React.CSSProperties;
}

const TruncatedText: React.FC<TruncatedTextProps> = ({
  text,
  emptyText = '-',
  maxWidth = '100%',
  copyable = false,
  mono = false,
  tooltipThreshold = 48,
  style,
}) => {
  const [copied, setCopied] = useState(false);
  const value = text === undefined || text === null || text === '' ? '' : String(text);
  const hasValue = value.length > 0;
  const shouldTooltip = hasValue && value.length > tooltipThreshold;

  const content = (
    <span
      style={{
        display: 'inline-block',
        maxWidth,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        verticalAlign: 'bottom',
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        ...style,
      }}
    >
      {hasValue ? value : emptyText}
    </span>
  );

  const wrapped = shouldTooltip ? (
    <Tooltip title={value} placement="topLeft" styles={{ root: { maxWidth: 900 } }}>
      {content}
    </Tooltip>
  ) : content;

  if (!copyable || !hasValue) return wrapped;

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    await copyText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%' }}>
      {wrapped}
      <Tooltip title={copied ? '已复制' : '复制'}>
        <CopyOutlined
          role="button"
          aria-label="复制文本"
          onClick={handleCopy}
          style={{ color: copied ? 'var(--accent-green)' : 'var(--accent-blue)', cursor: 'pointer', flexShrink: 0 }}
        />
      </Tooltip>
    </span>
  );
};

export default TruncatedText;
