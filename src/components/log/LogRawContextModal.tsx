import React, { useMemo } from 'react';
import { Modal, Tag, Button } from 'antd';
import { CopyOutlined, FileTextOutlined } from '@ant-design/icons';
import type { LogEntry } from '../../logParser';
import HighlightedText from './HighlightedText';
import { copyText } from '../../utils/copyText';

interface LogRawContextModalProps {
  open: boolean;
  onClose: () => void;
  entries: LogEntry[];
  centerEntryId: string | null;
  contextRadius?: number;
  keyword?: string;
}

const LogRawContextModal: React.FC<LogRawContextModalProps> = ({
  open,
  onClose,
  entries,
  centerEntryId,
  contextRadius = 20,
  keyword,
}) => {
  const { slice, startIndex, centerIndex } = useMemo(() => {
    if (!centerEntryId) return { slice: [] as LogEntry[], startIndex: 0, centerIndex: -1 };
    const idx = entries.findIndex(e => e.id === centerEntryId);
    if (idx < 0) return { slice: [] as LogEntry[], startIndex: 0, centerIndex: -1 };
    const start = Math.max(0, idx - contextRadius);
    const end = Math.min(entries.length, idx + contextRadius + 1);
    return { slice: entries.slice(start, end), startIndex: start, centerIndex: idx };
  }, [entries, centerEntryId, contextRadius]);

  const center = centerIndex >= 0 ? entries[centerIndex] : null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={onClose}
      okText="关闭"
      cancelButtonProps={{ style: { display: 'none' } }}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileTextOutlined />
          原始日志上下文
          {center && <Tag style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>{center.id}</Tag>}
        </span>
      }
      width={980}
      styles={{ body: { paddingTop: 12 } }}
    >
      {center ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {center.timestamp} · {center.method} {center.url}
              <span style={{ margin: '0 6px' }}>·</span>
              上下文范围：±{contextRadius} 行（共 {slice.length} 行）
            </div>
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={async () => {
                const content = slice.map(e => e.rawLine).join('\n');
                await copyText(content);
              }}
            >
              复制上下文
            </Button>
          </div>
          <pre
            style={{
              margin: 0,
              maxHeight: 520,
              overflow: 'auto',
              padding: 12,
              border: '1px solid var(--border-color)',
              borderRadius: 10,
              background: 'var(--bg-surface)',
              fontSize: 12,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {slice.map((e, i) => {
              const absoluteIndex = startIndex + i;
              const isCenter = absoluteIndex === centerIndex;
              return (
                <div
                  key={e.id}
                  style={{
                    padding: '2px 6px',
                    borderRadius: 6,
                    background: isCenter ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
                    border: isCenter ? '1px solid rgba(59, 130, 246, 0.25)' : '1px solid transparent',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', marginRight: 8 }}>{String(absoluteIndex).padStart(6, ' ')}</span>
                  <HighlightedText text={e.rawLine} keyword={keyword} />
                </div>
              );
            })}
          </pre>
        </>
      ) : (
        <div style={{ padding: 24, color: 'var(--text-muted)' }}>未找到对应日志条目。</div>
      )}
    </Modal>
  );
};

export default LogRawContextModal;

