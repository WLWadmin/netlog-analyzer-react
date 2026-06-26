import React from 'react';
import { Progress, Spin } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

interface LoadingOverlayProps {
  visible: boolean;
  progress?: number;
  phase?: string;
  message?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  visible,
  progress,
  phase,
  message,
}) => {
  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(13, 17, 23, 0.9)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      gap: 24,
    }}>
      <div style={{
        width: 72,
        height: 72,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.15), rgba(99, 102, 241, 0.15))',
        border: '2px solid rgba(14, 165, 233, 0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}>
        <Spin indicator={<LoadingOutlined style={{ fontSize: 32, color: '#0ea5e9' }} spin />} />
      </div>
      <div style={{ textAlign: 'center', maxWidth: 400, width: '80%' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
          {phase || '正在处理...'}
        </div>
        {progress !== undefined && (
          <Progress
            percent={progress}
            strokeColor={{ '0%': '#0ea5e9', '100%': '#6366f1' }}
            railColor="var(--bg-elevated)"
            showInfo={false}
            style={{ marginBottom: 12 }}
          />
        )}
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {message || '请稍候...'}
        </div>
      </div>
    </div>
  );
};
