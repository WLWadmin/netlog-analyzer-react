import { useState, useCallback, useRef } from 'react';
import { Upload, message, Button, notification } from 'antd';
import {
  CloudUploadOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import type { HarRepairResult } from '../../utils/harRepair';
import type { UploadFileTypeHint } from '../../upload/parseUploadedInput';
import {
  isSupportedUploadName,
  isTraceAnalysisEnabled,
  uploadAccept,
} from '../../upload/traceUploadFeature';

const { Dragger } = Upload;

const MB = 1024 * 1024;
const LARGE_FILE_MB = 20;
const VERY_LARGE_FILE_MB = 50;

function formatFileSize(size: number): string {
  if (size >= MB) return `${(size / MB).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(size / 1024))}KB`;
}

export interface UploadZoneProps {
  onFileLoaded?: (
    data: unknown,
    isTextLog?: boolean,
    repairInfo?: HarRepairResult,
    fileTypeHint?: UploadFileTypeHint
  ) => void | Promise<void>;
  onFilesSelected?: (files: File[]) => void | Promise<void>;
  /** 紧凑模式：只显示一个小按钮，不显示全屏拖拽区域 */
  compact?: boolean;
  /** 是否允许多文件上传 */
  multiple?: boolean;
}

const UploadZone: React.FC<UploadZoneProps> = ({
  onFileLoaded,
  onFilesSelected,
  compact = false,
  multiple = false,
}) => {
  const traceEnabled = isTraceAnalysisEnabled();
  const accept = uploadAccept();
  const formats = !traceEnabled
    ? 'JSON / HAR / LOG'
    : 'JSON / HAR / LOG / Trace / gzip';
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);

  const customRequest = ({ file, onSuccess }: any) => {
    setReading(true);

    const fileList: File[] = Array.isArray(file) ? file : [file];

    (async () => {
      try {
        if (!compact) {
          await onFilesSelected?.(fileList);
          onSuccess?.('ok');
          setReading(false);
          return;
        }
        const compactFileLoader = onFileLoaded;
        if (!compactFileLoader) {
          throw new Error('追加上传处理器未配置');
        }
        for (const f of fileList) {
          await compactFileLoader(f);
          onSuccess?.('ok');
        }

        setTimeout(() => {
          setReading(false);
        }, 300);
      } catch (err: any) {
        setReading(false);
        message.error(err.message || '文件读取失败');
      }
    })();
  };

  const beforeUpload = (file: File) => {
    if (file.name.toLowerCase().endsWith('.zip')) {
      notification.error({
        title: '不支持 ZIP 压缩包',
        description: '当前支持 gzip 压缩的 Trace，不支持 ZIP 压缩包。请先解压 ZIP，再上传其中的 JSON / Trace 文件。',
        placement: 'top',
        duration: 5,
      });
      return false;
    }
    if (!isSupportedUploadName(file.name)) {
      notification.error({
        title: '文件格式不支持',
        description: traceEnabled
          ? `「${file.name}」无法解析。请上传 Trace、NetLog、HAR 或 .log 文件。`
          : `「${file.name}」无法解析。请上传 .json (NetLog)、.har 或 .log 文件。`,
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
        title: '文件较大，将在 Worker 中解析',
        description: `「${file.name}」大小为 ${formatFileSize(file.size)}，解析将在浏览器本地 Worker 中进行。`,
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
        accept={accept}
        showUploadList={false}
        disabled={reading}
        multiple={multiple}
      >
        <Button
          type="primary"
          icon={<CloudUploadOutlined />}
          loading={reading}
        >
          {reading
            ? '读取中...'
            : traceEnabled
              ? '上传 Trace / NetLog / HAR 文件'
              : '上传 NetLog / HAR 文件'}
        </Button>
      </Upload>
    );
  }

  return (
    <div
      ref={dropRef}
      className={`diagnostic-upload-zone${dragOver ? ' is-dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <Dragger
        customRequest={customRequest}
        beforeUpload={beforeUpload}
        accept={accept}
        showUploadList={false}
        disabled={reading}
        multiple={multiple}
        aria-label="选择诊断文件"
      >
        <div className="diagnostic-upload-content">
          <div className="diagnostic-upload-icon" aria-hidden="true">
            {dragOver ? (
              <CloudUploadOutlined />
            ) : (
              <FileTextOutlined />
            )}
          </div>

          <p className="diagnostic-upload-title">
            {dragOver ? (
              '松开鼠标上传文件'
            ) : (
              <>
                <span className="diagnostic-upload-desktop-copy">拖拽文件到这里，或选择文件</span>
                <span className="diagnostic-upload-mobile-copy">选择诊断文件</span>
              </>
            )}
          </p>
          <p className="diagnostic-upload-description">
            文件结构唯一明确时自动开始；不确定时再由你选择格式
          </p>
          <p className="diagnostic-upload-formats">
            {formats}
            {traceEnabled && <span className="diagnostic-upload-beta">Trace 分析 Beta</span>}
            {' · '}{multiple ? 'HAR + NetLog 联合诊断' : '单文件'}
          </p>

          <div className="diagnostic-upload-badges" aria-label="处理方式">
            <div>
              <ThunderboltOutlined aria-hidden="true" />
              <span>本地 Worker</span>
            </div>
            <div>
              <SafetyOutlined aria-hidden="true" />
              <span>数据不出浏览器</span>
            </div>
          </div>
        </div>
      </Dragger>
    </div>
  );
};

export default UploadZone;
