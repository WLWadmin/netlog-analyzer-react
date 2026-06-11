import { useState, useCallback, useRef } from 'react';
import { Upload, message, Progress } from 'antd';
import {
  CloudUploadOutlined,
  FileTextOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
  SafetyOutlined,
} from '@ant-design/icons';

const { Dragger } = Upload;

interface UploadZoneProps {
  onFileLoaded: (data: any) => void;
}

const UploadZone: React.FC<UploadZoneProps> = ({ onFileLoaded }) => {
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [readProgress, setReadProgress] = useState(0);
  const dropRef = useRef<HTMLDivElement>(null);

  const customRequest = ({ file, onSuccess }: any) => {
    setReading(true);
    setReadProgress(0);

    const reader = new FileReader();

    const progressInterval = setInterval(() => {
      setReadProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + Math.random() * 15;
      });
    }, 200);

    reader.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        setReadProgress(pct);
      }
    };

    reader.onload = (e) => {
      clearInterval(progressInterval);
      setReadProgress(100);
      try {
        const json = JSON.parse(e.target?.result as string);
        setTimeout(() => {
          onFileLoaded(json);
          onSuccess?.('ok');
          setReading(false);
          setReadProgress(0);
        }, 300);
      } catch (err) {
        setReading(false);
        setReadProgress(0);
        message.error('JSON 解析失败: ' + (err as Error).message);
      }
    };
    reader.onerror = () => {
      clearInterval(progressInterval);
      setReading(false);
      setReadProgress(0);
      message.error('文件读取失败');
    };
    reader.readAsText(file);
  };

  const beforeUpload = (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.json') && !lower.endsWith('.har')) {
      message.error('请上传 .json (NetLog) 或 .har 格式的文件');
      return false;
    }
    return true;
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropRef.current && !dropRef.current.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  return (
    <div
      ref={dropRef}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        position: 'relative',
        borderRadius: 20,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        transform: dragOver ? 'scale(1.01)' : 'scale(1)',
      }}
    >
      {/* Animated border glow on drag */}
      {dragOver && (
        <div
          style={{
            position: 'absolute',
            inset: -3,
            borderRadius: 23,
            background: 'linear-gradient(135deg, #0ea5e9, #6366f1, #22d3ee, #0ea5e9)',
            backgroundSize: '300% 300%',
            animation: 'borderGlow 2s ease infinite',
            zIndex: 0,
            opacity: 0.8,
          }}
        />
      )}

      {/* Reading overlay */}
      {reading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 20,
            background: 'var(--bg-base)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            gap: 20,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.15), rgba(99, 102, 241, 0.15))',
              border: '2px solid rgba(14, 165, 233, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          >
            <LoadingOutlined style={{ fontSize: 32, color: '#0ea5e9' }} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              正在读取并解析文件...
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              文件较大时可能需要几秒钟
            </div>
            <Progress
              percent={Math.round(readProgress)}
              strokeColor={{
                '0%': '#0ea5e9',
                '100%': '#6366f1',
              }}
              trailColor="rgba(14, 165, 233, 0.1)"
              showInfo={false}
              size="small"
              style={{ width: 280 }}
            />
          </div>
        </div>
      )}

      <Dragger
        customRequest={customRequest}
        beforeUpload={beforeUpload}
        accept=".json,.har"
        showUploadList={false}
        disabled={reading}
        style={{
          background: dragOver
            ? 'linear-gradient(135deg, rgba(14, 165, 233, 0.06), rgba(99, 102, 241, 0.06))'
            : 'var(--bg-surface)',
          border: dragOver
            ? '2px dashed #0ea5e9'
            : '2px dashed var(--border-color)',
          borderRadius: 20,
          padding: '80px 40px',
          minHeight: 320,
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div style={{ transition: 'transform 0.3s', transform: dragOver ? 'translateY(-4px)' : 'translateY(0)' }}>
          {/* Main icon */}
          <div
            style={{
              width: 80,
              height: 80,
              margin: '0 auto 24px',
              borderRadius: 22,
              background: dragOver
                ? 'linear-gradient(135deg, rgba(14, 165, 233, 0.2), rgba(99, 102, 241, 0.2))'
                : 'linear-gradient(135deg, rgba(14, 165, 233, 0.1), rgba(99, 102, 241, 0.1))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s',
              border: dragOver
                ? '1px solid rgba(14, 165, 233, 0.3)'
                : '1px solid var(--border-color)',
            }}
          >
            {dragOver ? (
              <CloudUploadOutlined style={{ fontSize: 36, color: '#0ea5e9' }} />
            ) : (
              <FileTextOutlined style={{ fontSize: 36, color: 'var(--accent-blue)' }} />
            )}
          </div>

          {/* Title */}
          <p style={{ fontSize: 20, color: 'var(--text-primary)', marginBottom: 10, fontWeight: 600 }}>
            {dragOver ? '松开鼠标上传文件' : '拖拽或点击上传 NetLog / HAR 文件'}
          </p>

          {/* Description */}
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
            支持 chrome://net-export/ 或 edge://net-export/ 导出的 .json 文件
            <br />
            也支持浏览器 DevTools → Network → 导出的 .har 文件（上传后自动识别类型）
          </p>

          {/* Feature badges */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                background: 'rgba(14, 165, 233, 0.08)',
                borderRadius: 8,
                border: '1px solid rgba(14, 165, 233, 0.15)',
              }}
            >
              <ThunderboltOutlined style={{ fontSize: 13, color: '#0ea5e9' }} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>本地解析</span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                background: 'rgba(52, 211, 153, 0.08)',
                borderRadius: 8,
                border: '1px solid rgba(52, 211, 153, 0.15)',
              }}
            >
              <SafetyOutlined style={{ fontSize: 13, color: '#34d399' }} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>不上传服务器</span>
            </div>
          </div>
        </div>
      </Dragger>

      <style>{`
        @keyframes borderGlow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.8; }
        }
      `}</style>
    </div>
  );
};

export default UploadZone;
