import type {
  FileParserId,
  FormatCandidate,
  FormatResolution,
} from '../../upload/fileFormatTypes';

interface FormatRecommendationProps {
  resolution: FormatResolution;
  requestedParserId?: FileParserId;
  onConfirm(parserId: FileParserId): void;
  onReset(): void;
}

const PARSER_COPY: Record<FileParserId, {
  name: string;
  purpose: string;
}> = {
  'har@1': {
    name: 'HAR',
    purpose: '适用于浏览器网络请求与瀑布分析',
  },
  'chromium-netlog@1': {
    name: 'Chrome NetLog',
    purpose: '适用于浏览器网络栈、连接与协议证据分析',
  },
  'chromium-performance-trace@1': {
    name: 'Chromium Performance Trace',
    purpose: '适用于页面加载、主线程、渲染与交互分析',
  },
  'go-service-log@1': {
    name: 'Go Log',
    purpose: '适用于服务端调用流程与阶段耗时分析',
  },
};

const EVIDENCE_COPY: Record<string, string> = {
  HAR_LOG_OBJECT: '顶层包含 HAR log 对象',
  HAR_ENTRIES_ARRAY: '包含网络请求 entries',
  HAR_ENTRY_REQUEST_RESPONSE: '请求与响应结构完整',
  NETLOG_EVENTS_ARRAY: '顶层包含 NetLog events',
  NETLOG_CONSTANTS_OBJECT: '包含 NetLog constants',
  NETLOG_EVENT_SEMANTICS: '事件包含来源、类型与时间语义',
  TRACE_EVENTS_ARRAY: '顶层包含 traceEvents',
  TRACE_EVENT_TIMING_FIELDS: '事件包含名称、阶段与时间戳',
  TRACE_EVENT_THREAD_FIELDS: '事件包含进程或线程字段',
  GO_LOG_TEXT: '文件为文本日志',
  GO_LOG_LINE_SYNTAX: '日志行符合 Go 服务日志语法',
};

function candidateList(resolution: FormatResolution): FormatCandidate[] {
  if (resolution.kind === 'recommended') return [resolution.candidate];
  if (resolution.kind === 'needs-choice') return resolution.candidates;
  return [];
}

const FormatRecommendation: React.FC<FormatRecommendationProps> = ({
  resolution,
  requestedParserId,
  onConfirm,
  onReset,
}) => {
  const candidates = candidateList(resolution);
  if (resolution.kind === 'unsupported') {
    return (
      <div className="format-state format-error" role="alert">
        <strong>无法确认文件类型</strong>
        <p>没有发现 HAR、NetLog、Performance Trace 或 Go Log 的完整结构。</p>
        <button type="button" onClick={onReset}>重新选择文件</button>
      </div>
    );
  }

  return (
    <div className="format-state" aria-live="polite">
      <span className="format-state-kicker">
        {requestedParserId
          ? '文件类型与打开方式不匹配'
          : resolution.kind === 'needs-choice'
            ? '请选择文件格式'
            : '推荐打开方式'}
      </span>
      {candidates.map(candidate => {
        const copy = PARSER_COPY[candidate.parserId];
        return (
          <div className="format-candidate" key={candidate.parserId}>
            <h2>{copy.name}</h2>
            <p>{copy.purpose}</p>
            <div className="format-evidence">
              <strong>结构依据</strong>
              <ul>
                {candidate.evidenceCodes.map(code => (
                  <li key={code}>{EVIDENCE_COPY[code] ?? '检测到兼容结构'}</li>
                ))}
              </ul>
            </div>
            <button type="button" onClick={() => onConfirm(candidate.parserId)}>
              使用 {copy.name} 打开
            </button>
          </div>
        );
      })}
      <button className="secondary-action" type="button" onClick={onReset}>
        重新选择文件
      </button>
    </div>
  );
};

export default FormatRecommendation;
