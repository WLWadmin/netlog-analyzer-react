import UploadZone from '../netlog/UploadZone';
import type { FileParserId } from '../../upload/fileFormatTypes';
import type { IntakeState } from '../../upload/useAnalysisIntake';
import AnalysisProgressPanel from './AnalysisProgressPanel';
import FormatRecommendation from './FormatRecommendation';
import ParserModeSelect, { type ParserMode } from './ParserModeSelect';
import './uploadEntry.css';

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

const EMPTY_PROGRESS = {
  phase: 'probing-format' as const,
  label: '正在预检文件结构',
  mode: 'indeterminate' as const,
  phaseIndex: 0,
  phaseCount: 5,
  startedAt: 0,
  updatedAt: 0,
};

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
    : state.status === 'validating' || state.status === 'parsing'
      ? state.progress ?? {
        ...EMPTY_PROGRESS,
        taskId: state.taskId,
        parserId: state.parserId,
        phase: state.status === 'validating' ? 'validating' as const : 'parsing-structure' as const,
        label: state.status === 'validating' ? '正在严格校验文件结构' : '正在解析文件结构',
        phaseIndex: 1,
      }
      : state.status === 'probing'
        ? state.progress ?? { ...EMPTY_PROGRESS, taskId: state.taskId }
        : undefined;

  return (
    <section className="upload-entry" aria-labelledby="upload-entry-title">
      <header className="upload-entry-heading">
        <div>
          <h1 id="upload-entry-title">导入诊断文件</h1>
          <p>选择文件后，系统将在本地识别格式并开始分析。</p>
        </div>
        <div className="upload-trust-state" aria-label="本地处理状态">
          <strong>本地处理</strong>
          <span>文件不会上传服务器</span>
        </div>
      </header>

      <div className="upload-console">
        <div className="upload-console-main">
          <div className="upload-console-toolbar">
            <div>
              <strong>文件接入</strong>
              <span>支持拖拽或选择单个诊断文件</span>
            </div>
          </div>

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
              <button type="button" onClick={onReset}>重新选择文件</button>
            </div>
          ) : null}
        </div>

      </div>
    </section>
  );
};

export default UploadEntry;
