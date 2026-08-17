import UploadZone from '../netlog/UploadZone';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import type { FileParserId } from '../../upload/fileFormatTypes';
import type { IntakeState } from '../../upload/useAnalysisIntake';
import AnalysisProgressPanel from './AnalysisProgressPanel';
import FormatRecommendation from './FormatRecommendation';
import ParserModeSelect, { type ParserMode } from './ParserModeSelect';
import './uploadEntry.css';

const FORMAT_CAPABILITIES = [
  { code: 'NETLOG', title: '连接为什么没有建立？', scope: '代理、DNS、Socket、TLS 与协议' },
  { code: 'HAR', title: '哪些页面请求失败或变慢？', scope: '请求、响应、状态码与 Timing' },
  { code: 'TRACE', title: '页面为什么卡顿？', scope: '主线程、渲染、长任务与交互' },
  { code: 'LOG', title: '应用当时发生了什么？', scope: '业务流程、结果与服务端上下文' },
];

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
            <>
              <UploadZone onFilesSelected={onFilesSelected} multiple={false} />
              <section className="upload-capability-map" aria-labelledby="upload-capability-title">
                <div className="upload-capability-heading">
                  <div>
                    <span>DIAGNOSTIC CAPABILITY MAP</span>
                    <strong id="upload-capability-title">不同文件主要能回答什么？</strong>
                  </div>
                  <small>选择文件后自动识别</small>
                </div>
                <div className="upload-capability-grid">
                  {FORMAT_CAPABILITIES.map(format => (
                    <article key={format.code}>
                      <code>{format.code}</code>
                      <strong>{format.title}</strong>
                      <span>{format.scope}</span>
                    </article>
                  ))}
                </div>
              </section>
            </>
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
