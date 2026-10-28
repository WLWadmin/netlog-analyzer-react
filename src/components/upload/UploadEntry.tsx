import UploadZone from '../netlog/UploadZone';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import type { FileParserId } from '../../upload/fileFormatTypes';
import type { IntakeState } from '../../upload/useAnalysisIntake';
import AnalysisProgressPanel from './AnalysisProgressPanel';
import FormatRecommendation from './FormatRecommendation';
import ParserModeSelect, { type ParserMode } from './ParserModeSelect';
import './uploadEntry.css';
import FileQualityPanel from '../shared/FileQualityPanel';

interface UploadEntryProps {
  traceEnabled: boolean;
  state: IntakeState;
  parserMode: ParserMode;
  onParserModeChange(mode: ParserMode): void;
  onFilesSelected(files: File[]): void;
  onConfirm(parserId: FileParserId): void;
  onReset(): void;
  onCancel(): void;
  onContinue(): void;
}

const UploadEntry: React.FC<UploadEntryProps> = ({
  traceEnabled,
  state,
  parserMode,
  onParserModeChange,
  onFilesSelected,
  onConfirm,
  onReset,
  onCancel,
  onContinue,
}) => {
  const progress = state.status === 'ready'
    ? state.progress
    : state.status === 'probing'
      || state.status === 'validating'
      || state.status === 'parsing'
      ? state.progress
        : undefined;

  return (
    <section className="upload-entry" aria-labelledby="upload-entry-title">
      <header className="upload-entry-heading">
        <div>
          <h1 id="upload-entry-title">导入诊断文件</h1>
          <p>选择文件后，系统将在本地识别格式并开始分析。</p>
        </div>
        <div className="upload-trust-state" aria-label="本地处理状态">
          <SafetyCertificateOutlined aria-hidden="true" />
          <span><strong>仅在本机处理</strong><small>文件不会上传服务器</small></span>
        </div>
      </header>

      <div className="upload-console">
        <div className="upload-console-main">
          <ParserModeSelect
            value={parserMode}
            traceEnabled={traceEnabled}
            onChange={onParserModeChange}
          />

          {state.status === 'idle' || state.status === 'completed' ? (
            <UploadZone onFilesSelected={onFilesSelected} multiple={false} />
          ) : null}

          {progress ? (
            <AnalysisProgressPanel
              progress={progress}
              autoContinueAt={state.status === 'ready' ? state.autoContinueAt : undefined}
              onCancel={onCancel}
              onContinue={onContinue}
            />
          ) : null}

          {state.status === 'awaiting-confirmation' ? (
            <FormatRecommendation
              resolution={state.resolution}
              onConfirm={onConfirm}
              onReset={onReset}
            />
          ) : null}

          {state.status === 'failed' && state.resolution ? (
            <FormatRecommendation
              resolution={state.resolution}
              requestedParserId={state.code === 'PARSER_MISMATCH'
                ? parserMode === 'recommend' ? undefined : parserMode
                : undefined}
              onConfirm={onConfirm}
              onReset={onReset}
            />
          ) : null}

          {state.status === 'failed' && !state.resolution ? (
            <div className="format-state format-error" role="alert">
              <strong>分析已停止</strong>
              <p>{state.message}</p>
              <FileQualityPanel report={state.qualityReport} />
              <button type="button" onClick={onReset}>重新选择文件</button>
            </div>
          ) : null}
        </div>

      </div>
    </section>
  );
};

export default UploadEntry;
