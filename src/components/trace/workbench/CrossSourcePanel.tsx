import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createFileParseInput } from '../../../upload/createFileFormatIntake';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import type {
  CrossSourceKind,
  SourceDescriptor,
} from '../../../workbench/crossSourceProtocol';

const KIND_LABEL: Record<CrossSourceKind, string> = {
  trace: 'Trace',
  har: 'HAR',
  netlog: 'NetLog',
};

const CLOCK_LABEL: Record<SourceDescriptor['clockDomain']['kind'], string> = {
  'trace-monotonic-us': 'Trace 单调时钟',
  'har-epoch-ms': 'HAR Epoch 时钟',
  'netlog-epoch-ms': 'NetLog Epoch 时钟',
  'netlog-time-tick-ms': 'NetLog Tick 时钟',
  unknown: '时钟域未知',
};

const STATE_LABEL: Record<SourceDescriptor['state'], string> = {
  loading: '正在加载',
  ready: '可用',
  degraded: '部分可用',
  rejected: '已拒绝',
  removing: '正在移除',
  released: '已释放',
};

interface PendingReplacement {
  file: File;
  kind: 'har' | 'netlog';
  sourceId: string;
}

function requireSourceChange(
  response: Awaited<ReturnType<TraceWorkbenchClient['addSource']>>,
): void {
  if (response.type === 'source-change-result') return;
  if (response.type === 'structured-error') {
    throw new Error(response.error.message);
  }
  if (response.type === 'capability-missing') throw new Error(response.reason);
  throw new Error('来源操作未返回有效结果。');
}

const CrossSourcePanel: React.FC<{ client: TraceWorkbenchClient }> = ({ client }) => {
  const snapshot = useSyncExternalStore(
    client.subscribe.bind(client),
    client.getSnapshot.bind(client),
    client.getSnapshot.bind(client),
  );
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [pendingReplacement, setPendingReplacement] =
    useState<PendingReplacement>();
  const operationSequence = useRef(0);
  const sources = snapshot.sources?.sources ?? [];

  useEffect(() => {
    void client.querySources().catch(() => undefined);
  }, [client]);

  const refresh = async () => {
    await client.queryAlignments();
    await client.queryCorrelations();
    await client.queryEvidenceGraph();
  };

  const validate = async (file: File, kind: 'har' | 'netlog') => {
    const sequence = ++operationSequence.current;
    const input = await createFileParseInput(file, `cross-source-${sequence}`, {
      onProgress: update => {
        if (sequence !== operationSequence.current) return;
        setProgress(update.mode === 'determinate'
          ? `${update.label}：${update.completed} / ${update.total} ${update.unit}`
          : update.label);
      },
    });
    const expectedParser = kind === 'har' ? 'har@1' : 'chromium-netlog@1';
    const match = input.probeVerdicts?.find(verdict => verdict.parserId === expectedParser);
    if (match?.kind !== 'definite-match') {
      throw new Error(`文件未通过 ${KIND_LABEL[kind]} 专用格式校验。`);
    }
  };

  const add = async (file: File, kind: 'har' | 'netlog') => {
    setError('');
    try {
      await validate(file, kind);
      const existing = sources.find(source => source.kind === kind);
      if (existing) {
        setPendingReplacement({ file, kind, sourceId: existing.sourceId });
        return;
      }
      setProgress(`Worker 正在解析 ${file.size} bytes`);
      requireSourceChange(await client.addSource(file, kind));
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '来源追加失败，已保留稳定来源。');
    } finally {
      setProgress('');
    }
  };

  const confirmReplacement = async () => {
    if (!pendingReplacement) return;
    const pending = pendingReplacement;
    setPendingReplacement(undefined);
    setError('');
    try {
      setProgress(`Worker 正在替换 ${pending.file.size} bytes`);
      requireSourceChange(await client.replaceSource(
        pending.file,
        pending.kind,
        pending.sourceId,
      ));
      await refresh();
    } catch {
      setError('来源替换失败，已保留原稳定来源。');
    } finally {
      setProgress('');
    }
  };

  const remove = async (source: SourceDescriptor) => {
    setError('');
    setProgress(`Worker 正在释放 ${source.byteLength} bytes`);
    try {
      requireSourceChange(await client.removeSource(source.sourceId));
      await refresh();
    } catch {
      setError('来源移除失败，现有工作台状态保持不变。');
    } finally {
      setProgress('');
    }
  };

  return (
    <section className="trace-cross-source-panel" aria-labelledby="trace-source-heading">
      <header>
        <div>
          <span>LOCAL SOURCES</span>
          <h3 id="trace-source-heading">来源与校时</h3>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}
        >
          {expanded ? '收起来源' : `管理来源（${sources.length}）`}
        </button>
      </header>
      {!expanded && (
        <p className="trace-source-summary">
          {sources.map(source => KIND_LABEL[source.kind]).join(' + ') || 'Trace'}
          {' · '}
          {sources.every(source => (
            source.kind === 'trace' || source.clockDomain.calibrated
          )) ? '已校时' : '存在未校准来源'}
        </p>
      )}
      {expanded && (
        <>
          <div className="trace-source-actions">
            <label>
              追加 HAR
              <input
                aria-label="追加 HAR 文件"
                type="file"
                accept=".har,.json,application/json"
                onChange={event => {
                  const file = event.target.files?.[0];
                  if (file) void add(file, 'har');
                  event.target.value = '';
                }}
              />
            </label>
            <label>
              追加 NetLog
              <input
                aria-label="追加 NetLog 文件"
                type="file"
                accept=".json,application/json"
                onChange={event => {
                  const file = event.target.files?.[0];
                  if (file) void add(file, 'netlog');
                  event.target.value = '';
                }}
              />
            </label>
          </div>
          <ul className="trace-source-list">
            {sources.map(source => (
              <li key={source.sourceId}>
                <div>
                  <strong>{source.label}</strong>
                  <span>
                    {STATE_LABEL[source.state]} · {CLOCK_LABEL[source.clockDomain.kind]}
                    {' · '}{source.clockDomain.calibrated ? '已校准' : '未校准'}
                  </span>
                </div>
                {source.kind !== 'trace' && (
                  <button
                    type="button"
                    onClick={() => remove(source)}
                    aria-label={`移除 ${source.label}`}
                  >
                    移除
                  </button>
                )}
                {source.limitations.map(limitation => (
                  <p key={limitation}>{limitation}</p>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
      {pendingReplacement && (
        <div role="alertdialog" aria-label="确认替换来源">
          <p>已存在 {KIND_LABEL[pendingReplacement.kind]} 来源。替换会撤销依赖旧来源的关联和诊断。</p>
          <button type="button" onClick={confirmReplacement}>确认替换</button>
          <button type="button" onClick={() => setPendingReplacement(undefined)}>取消替换</button>
        </div>
      )}
      {progress && <p role="status">{progress}</p>}
      {error && <p className="trace-export-error" role="alert">{error}</p>}
    </section>
  );
};

export default CrossSourcePanel;
