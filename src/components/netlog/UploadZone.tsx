import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, message, Progress, Button, notification } from 'antd';
import {
  CloudUploadOutlined,
  FileTextOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import type { HarRepairResult } from '../../utils/harRepair';

const { Dragger } = Upload;

const MB = 1024 * 1024;
const LARGE_FILE_MB = 20;
const VERY_LARGE_FILE_MB = 50;

function formatFileSize(size: number): string {
  if (size >= MB) return `${(size / MB).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(size / 1024))}KB`;
}

interface UploadZoneProps {
  onFileLoaded: (
    data: unknown,
    isTextLog?: boolean,
    repairInfo?: HarRepairResult,
    fileTypeHint?: 'netlog' | 'har' | 'log'
  ) => void | Promise<void>;
  /** 紧凑模式：只显示一个小按钮，不显示全屏拖拽区域 */
  compact?: boolean;
  /** 是否允许多文件上传 */
  multiple?: boolean;
}

const UploadZone: React.FC<UploadZoneProps> = ({ onFileLoaded, compact = false, multiple = true }) => {
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [readProgress, setReadProgress] = useState(0);
  const dropRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // 组件卸载时清理定时器，防止内存泄漏
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const readSingleFile = (file: File): Promise<{ content: string; fileName: string; isTextLog: boolean }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        const fileName = file.name.toLowerCase();
        const isTextLog = fileName.endsWith('.log');
        resolve({ content, fileName, isTextLog });
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
  };

  const parseSingleFile = async (
    content: string,
    fileName: string,
    isTextLog: boolean,
    onSuccess?: any
  ) => {
    try {
      if (isTextLog) {
        await onFileLoaded(content, true, undefined, 'log');
        onSuccess?.('ok');
        return;
      }

      if (fileName.endsWith('.har')) {
        await onFileLoaded(content, false, undefined, 'har');
        onSuccess?.('ok');
        return;
      }

      // .json 文件（NetLog）：交给 Worker 解析，避免大文件 JSON.parse 阻塞主线程
      await onFileLoaded(content, false, undefined, 'netlog');
      onSuccess?.('ok');
    } catch (err) {
      const msg = (err as Error).message;
      if (fileName.endsWith('.json') && msg.includes('不是标准 HAR')) {
        message.error('解析失败: 该文件不是标准 HAR 格式，请确认是否为 NetLog 或 HAR 文件');
      } else {
        message.error('解析失败: ' + msg);
      }
    }
  };

  const customRequest = ({ file, onSuccess }: any) => {
    setReading(true);
    setReadProgress(0);

    intervalRef.current = setInterval(() => {
      setReadProgress(prev => {
        if (prev >= 90) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = undefined;
          }
          return 90;
        }
        return prev + Math.random() * 15;
      });
    }, 200);

    const fileList: File[] = Array.isArray(file) ? file : [file];

    Promise.all(fileList.map(f => readSingleFile(f)))
      .then(async (results) => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = undefined;
        }
        setReadProgress(100);

        for (const { content, fileName, isTextLog } of results) {
          await parseSingleFile(content, fileName, isTextLog, onSuccess);
        }

        setTimeout(() => {
          setReading(false);
          setReadProgress(0);
        }, 300);
      })
      .catch((err) => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = undefined;
        }
        setReading(false);
        setReadProgress(0);
        message.error(err.message || '文件读取失败');
      });
  };

  const beforeUpload = (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.json') && !lower.endsWith('.har') && !lower.endsWith('.log')) {
      notification.error({
        title: '文件格式不支持',
        description: `「${file.name}」无法解析。请上传 .json (NetLog)、.har 或 .log 文件。`,
        placement: 'top',
        duration: 4,
        style: {
          width: 420,
          borderRadius: 14,
          boxShadow: '0 12px 32px -8px rgba(17, 24, 39, 0.14), 0 4px 12px -4px rgba(17, 24, 39, 0.08)',
          border: '1px solid rgba(0, 0, 0, 0.04)',
        },
      });
      return false;
    }
    const fileSizeMb = file.size / MB;
    if (fileSizeMb >= VERY_LARGE_FILE_MB) {
      notification.warning({
        title: '文件较大，解析可能较慢',
        description: `「${file.name}」大小为 ${formatFileSize(file.size)}，解析期间页面可能短暂无响应，请耐心等待。`,
        placement: 'top',
        duration: 6,
      });
    } else if (fileSizeMb >= LARGE_FILE_MB) {
      notification.info({
        title: '文件较大',
        description: `「${file.name}」大小为 ${formatFileSize(file.size)}，本地读取和解析可能需要几秒钟。`,
        placement: 'top',
        duration: 5,
      });
    }
    return true;
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
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
    dragDepthRef.current = 0;
    setDragOver(false);
  }, []);

  // 紧凑模式：只显示一个小上传按钮
  if (compact) {
    return (
      <Upload
        customRequest={customRequest}
        beforeUpload={beforeUpload}
        accept=".json,.har,.log"
        showUploadList={false}
        disabled={reading}
        multiple={multiple}
      >
        <Button
          icon={<CloudUploadOutlined />}
          loading={reading}
          style={{
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            border: 'none',
            color: '#fff',
            fontWeight: 600,
            borderRadius: 10,
            boxShadow: '0 2px 8px rgba(99, 102, 241, 0.25)',
          }}
        >
          {reading ? '读取中...' : '上传 NetLog / HAR 文件'}
        </Button>
      </Upload>
    );
  }

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
              正在读取文件...
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              读取完成后将在本地解析数据，文件较大时页面可能短暂繁忙
            </div>
            <Progress
              percent={Math.round(readProgress)}
              strokeColor={{
                '0%': '#0ea5e9',
                '100%': '#6366f1',
              }}
              railColor="rgba(14, 165, 233, 0.1)"
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
        accept=".json,.har,.log"
        showUploadList={false}
        disabled={reading}
        multiple={multiple}
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
            {dragOver ? '松开鼠标上传文件' : '拖拽或点击上传一个或多个日志文件'}
          </p>

          {/* Description */}
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 8, lineHeight: 1.6 }}>
            支持 chrome://net-export/ 或 edge://net-export/ 导出的 .json 文件
            <br />
            支持浏览器 DevTools → Network → 导出的 .har 文件
            <br />
            支持 Go 服务日志 .log 文件（上传后自动识别类型）
          </p>
          <p style={{ color: '#6366f1', fontSize: 13, marginBottom: 24, lineHeight: 1.6, fontWeight: 500 }}>
            可一次选择 HAR + NetLog 两个文件，自动进入联合诊断
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


    </div>
  );
};

export default UploadZone;
