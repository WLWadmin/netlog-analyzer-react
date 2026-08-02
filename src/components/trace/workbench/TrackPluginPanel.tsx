import {
  useEffect,
  useRef,
  useState,
} from 'react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import type {
  TrackPluginResultResponse,
  WorkbenchResponse,
  WorkbenchProjectedPluginEventDto,
  WorkbenchTrackPluginManifest,
} from '../../../workbench/protocol';

interface TrackPluginPanelProps {
  client: TraceWorkbenchClient;
  range: { startUs: number; endUs: number };
  onOverlaysChange(overlays: TrackPluginOverlay[]): void;
}

export interface TrackPluginOverlay {
  pluginId: string;
  label: string;
  trackId: `plugin:${string}`;
  events: WorkbenchProjectedPluginEventDto[];
  visible: boolean;
  truncated: boolean;
  limitations: string[];
}

function isUpdatedPluginResponse(
  response: TrackPluginResultResponse,
): response is Extract<
  TrackPluginResultResponse,
  { operation: 'installed' | 'refreshed' }
> {
  return response.operation === 'installed' || response.operation === 'refreshed';
}

function overlayFromResponse(
  response: Extract<
    TrackPluginResultResponse,
    { operation: 'installed' | 'refreshed' }
  >,
  visible = true,
): TrackPluginOverlay {
  return {
    pluginId: response.plugin.pluginId,
    label: response.plugin.label,
    trackId: response.plugin.trackId,
    events: response.projectedEvents,
    visible,
    truncated: response.truncation.truncated,
    limitations: response.limitations,
  };
}

const TrackPluginPanel: React.FC<TrackPluginPanelProps> = ({
  client,
  range,
  onOverlaysChange,
}) => {
  const [pluginId, setPluginId] = useState('');
  const [label, setLabel] = useState('');
  const [queryValue, setQueryValue] = useState('Task');
  const [overlays, setOverlays] = useState<TrackPluginOverlay[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const overlaysRef = useRef(overlays);
  const previousClientRef = useRef(client);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const rangeStartUs = range.startUs;
  const rangeEndUs = range.endUs;

  useEffect(() => {
    overlaysRef.current = overlays;
    onOverlaysChange(overlays);
  }, [onOverlaysChange, overlays]);

  useEffect(() => {
    if (previousClientRef.current === client) return;
    previousClientRef.current = client;
    overlaysRef.current = [];
    setOverlays([]);
    setStatus('');
    setError('');
  }, [client]);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const queryRange = { startUs: rangeStartUs, endUs: rangeEndUs };
      const currentOverlays = overlaysRef.current;
      if (currentOverlays.length > 0) {
        setError('');
        setStatus('正在更新临时轨道范围…');
        setOverlays(current => current.map(overlay => ({
          ...overlay,
          events: [],
        })));
      }
      for (const overlay of currentOverlays) {
        if (disposed) return;
        try {
          const response = await client.queryTrackPlugin(
            overlay.pluginId,
            queryRange,
          );
          if (disposed) return;
          if (response?.type === 'structured-error') {
            setError(`临时轨道刷新失败：${response.error.message}`);
            continue;
          }
          if (
            !response
            || response.type !== 'track-plugin-result'
            || !isUpdatedPluginResponse(response)
          ) {
            continue;
          }
          setOverlays(current => current.map(item => (
            item.pluginId === overlay.pluginId
              ? overlayFromResponse(response, item.visible)
              : item
          )));
          setStatus('临时轨道已更新到当前范围。');
        } catch {
          if (!disposed) setError('临时轨道刷新失败，已保留其他轨道。');
        }
      }
    };
    void refresh();
    return () => {
      disposed = true;
    };
  }, [client, rangeEndUs, rangeStartUs]);

  const install = async () => {
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(pluginId)) {
      setError('插件 ID 只能使用小写字母、数字和连字符，最长 48 字符。');
      return;
    }
    if (!label || label.length > 60 || !queryValue || queryValue.length > 128) {
      setError('插件名称或查询值为空或超过长度上限。');
      return;
    }
    const manifest: WorkbenchTrackPluginManifest = {
      pluginId,
      label,
      query: {
        clauses: [{ field: 'name', operator: 'contains', value: queryValue }],
      },
      maxEvents: 2_000,
    };
    setError('');
    setStatus('正在创建临时轨道…');
    try {
      const response = await client.installTrackPlugin(range, manifest);
      if (
        response?.type === 'track-plugin-result'
        && isUpdatedPluginResponse(response)
      ) {
        const currentRange = rangeRef.current;
        const rangeChanged = response.range.startUs !== currentRange.startUs
          || response.range.endUs !== currentRange.endUs;
        let currentResponse: WorkbenchResponse | undefined = response;
        if (rangeChanged) {
          setOverlays(current => [
            ...current.filter(item => item.pluginId !== pluginId),
            { ...overlayFromResponse(response), events: [] },
          ]);
          try {
            currentResponse = await client.queryTrackPlugin(
              response.plugin.pluginId,
              currentRange,
            );
          } catch {
            setStatus('');
            setError('临时轨道已创建，但当前范围刷新失败；未显示旧范围事件。');
            return;
          }
        }
        if (
          !currentResponse
          || currentResponse.type !== 'track-plugin-result'
          || !isUpdatedPluginResponse(currentResponse)
        ) {
          setStatus('');
          setError('临时轨道已创建，但当前范围刷新失败；未显示旧范围事件。');
          return;
        }
        const updatedResponse = currentResponse;
        const latestRange = rangeRef.current;
        if (
          updatedResponse.range.startUs !== latestRange.startUs
          || updatedResponse.range.endUs !== latestRange.endUs
        ) {
          setStatus('临时轨道正在更新当前范围。');
          return;
        }
        setOverlays(current => [
          ...current.filter(item => item.pluginId !== pluginId),
          overlayFromResponse(updatedResponse),
        ]);
        setStatus(`已创建 ${updatedResponse.plugin.label}，仅在当前会话有效。`);
      } else if (
        response?.type === 'structured-error'
        && response.error.code === 'unsupported-capability'
      ) {
        setStatus('');
        setError(`能力不可用：${response.error.message}`);
      } else {
        setStatus('');
        setError('临时轨道创建失败，当前时间轴仍可使用。');
      }
    } catch {
      setStatus('');
      setError('临时轨道创建失败，当前时间轴仍可使用。');
    }
  };

  const remove = async (overlay: TrackPluginOverlay) => {
    setError('');
    try {
      const response = await client.removeTrackPlugin(overlay.pluginId);
      if (
        response?.type === 'track-plugin-result'
        && response.operation === 'removed'
      ) {
        setOverlays(current => current.filter(
          item => item.pluginId !== overlay.pluginId,
        ));
        setStatus(`已移除 ${overlay.label}。`);
      } else {
        setError('临时轨道移除失败。');
      }
    } catch {
      setError('临时轨道移除失败。');
    }
  };

  return (
    <section className="trace-advanced-panel" aria-labelledby="trace-track-plugin-heading">
      <h3 id="trace-track-plugin-heading">受控临时轨道</h3>
      <p>规则由宿主声明式执行，不运行用户代码，也不持久化或导出。</p>
      <div className="trace-plugin-form">
        <label>
          插件 ID
          <input
            aria-label="插件 ID"
            maxLength={48}
            value={pluginId}
            onChange={event => setPluginId(event.target.value)}
          />
        </label>
        <label>
          插件名称
          <input
            aria-label="插件名称"
            maxLength={60}
            value={label}
            onChange={event => setLabel(event.target.value)}
          />
        </label>
        <label>
          名称包含
          <input
            aria-label="插件查询值"
            maxLength={128}
            value={queryValue}
            onChange={event => setQueryValue(event.target.value)}
          />
        </label>
        <button type="button" aria-label="添加临时轨道" onClick={install}>
          添加临时轨道
        </button>
      </div>
      <div aria-live="polite">
        {status && <p>{status}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
      <ul>
        {overlays.map(overlay => (
          <li key={overlay.pluginId}>
            <strong>{overlay.label}</strong>
            <span> · {overlay.events.length} 个投影事件</span>
            {overlay.truncated && <span> · 已截断</span>}
            {overlay.limitations.length > 0 && (
              <p>{overlay.limitations.join(' ')}</p>
            )}
            <button
              type="button"
              aria-label={`${overlay.visible ? '隐藏' : '显示'} ${overlay.label}`}
              onClick={() => setOverlays(current => current.map(item => (
                item.pluginId === overlay.pluginId
                  ? { ...item, visible: !item.visible }
                  : item
              )))}
            >
              {overlay.visible ? '隐藏' : '显示'}
            </button>
            <button
              type="button"
              aria-label={`移除 ${overlay.label}`}
              onClick={() => remove(overlay)}
            >
              移除
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default TrackPluginPanel;
