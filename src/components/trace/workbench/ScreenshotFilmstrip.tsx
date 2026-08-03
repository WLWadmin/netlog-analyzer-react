import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ScreenshotIndexResultResponse,
  WorkbenchResponse,
} from '../../../workbench/protocol';

interface ScreenshotClient {
  queryScreenshotIndex(): Promise<WorkbenchResponse>;
  queryScreenshot(screenshotId: string): Promise<WorkbenchResponse>;
}

interface ScreenshotFilmstripProps {
  client: ScreenshotClient;
  screenshotCount: number;
  captureRange?: { startUs: number; endUs: number };
  focusedTimestampUs?: number;
  hoveredTimestampUs?: number;
  onCursorTimestamp?(timestampUs: number): void;
  onSelectTimestamp?(timestampUs: number): void;
}

const SCREENSHOTS_PER_PAGE = 100;
const PRELOAD_RADIUS = 1;
const PLAYBACK_SPEEDS = [0.5, 1, 2] as const;

function nearestFrameIndex(
  screenshots: ScreenshotIndexResultResponse['screenshots'],
  timestampUs: number,
): number {
  if (screenshots.length < 2 || timestampUs <= screenshots[0].timestampUs) return 0;
  const lastIndex = screenshots.length - 1;
  if (timestampUs >= screenshots[lastIndex].timestampUs) return lastIndex;
  let low = 0;
  let high = lastIndex;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (screenshots[middle].timestampUs <= timestampUs) low = middle;
    else high = middle;
  }
  return timestampUs - screenshots[low].timestampUs
    <= screenshots[high].timestampUs - timestampUs
    ? low
    : high;
}

const ScreenshotFilmstrip: React.FC<ScreenshotFilmstripProps> = ({
  client,
  screenshotCount,
  captureRange,
  focusedTimestampUs,
  hoveredTimestampUs,
  onCursorTimestamp,
  onSelectTimestamp,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [index, setIndex] = useState<ScreenshotIndexResultResponse>();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [enlargedId, setEnlargedId] = useState<string>();
  const [page, setPage] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [cursorUs, setCursorUs] = useState<number>();
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof PLAYBACK_SPEEDS)[number]>(1);
  const liveUrls = useRef(new Map<string, string>());
  const inFlight = useRef(new Map<string, {
    promise: Promise<void>;
    token: symbol;
  }>());
  const desiredIds = useRef(new Set<string>());
  const mounted = useRef(true);
  const expandedRef = useRef(false);
  const generation = useRef(0);
  const playbackTimer = useRef<number | undefined>(undefined);
  const closeDialogButton = useRef<HTMLButtonElement>(null);
  const dialogTrigger = useRef<HTMLButtonElement | undefined>(undefined);
  const lastExternalTimestamp = useRef<number | undefined>(undefined);

  const orderedScreenshots = useMemo(
    () => [...(index?.screenshots ?? [])].sort((left, right) => (
      left.timestampUs - right.timestampUs
      || left.screenshotId.localeCompare(right.screenshotId)
    )),
    [index],
  );

  const clearPlaybackTimer = useCallback(() => {
    if (playbackTimer.current !== undefined) {
      window.clearTimeout(playbackTimer.current);
      playbackTimer.current = undefined;
    }
  }, []);

  const releaseUrls = useCallback(() => {
    for (const url of liveUrls.current.values()) URL.revokeObjectURL(url);
    liveUrls.current.clear();
    if (mounted.current) setUrls({});
  }, []);

  const markFrameFailed = useCallback((screenshotId: string) => {
    setFailedIds(current => (
      current.includes(screenshotId) ? current : [...current, screenshotId]
    ));
  }, []);

  useEffect(() => {
    mounted.current = true;
    const urlsToRelease = liveUrls.current;
    const pendingRequests = inFlight.current;
    return () => {
      mounted.current = false;
      expandedRef.current = false;
      generation.current += 1;
      clearPlaybackTimer();
      for (const url of urlsToRelease.values()) URL.revokeObjectURL(url);
      urlsToRelease.clear();
      pendingRequests.clear();
    };
  }, [clearPlaybackTimer]);

  useEffect(() => {
    generation.current += 1;
    expandedRef.current = false;
    clearPlaybackTimer();
    releaseUrls();
    inFlight.current.clear();
    desiredIds.current.clear();
    lastExternalTimestamp.current = undefined;
    setExpanded(false);
    setIndex(undefined);
    setFailedIds([]);
    setEnlargedId(undefined);
    setPage(0);
    setCurrentIndex(0);
    setCursorUs(undefined);
    setPlaying(false);
    setError('');
  }, [client, clearPlaybackTimer, releaseUrls]);

  const loadScreenshot = useCallback((screenshotId: string): Promise<void> => {
    if (liveUrls.current.has(screenshotId) || failedIds.includes(screenshotId)) {
      return Promise.resolve();
    }
    const existing = inFlight.current.get(screenshotId);
    if (existing) return existing.promise;
    const token = generation.current;
    const requestToken = Symbol(screenshotId);
    const pending = (async () => {
      try {
        const response = await client.queryScreenshot(screenshotId);
        if (response.type !== 'screenshot-result') {
          if (mounted.current && expandedRef.current && token === generation.current) {
            markFrameFailed(screenshotId);
          }
          return;
        }
        if (response.screenshot.screenshotId !== screenshotId) {
          if (mounted.current && expandedRef.current && token === generation.current) {
            markFrameFailed(screenshotId);
          }
          return;
        }
        const url = URL.createObjectURL(new Blob(
          [response.screenshot.bytes],
          { type: response.screenshot.mimeType },
        ));
        if (
          !mounted.current
          || !expandedRef.current
          || token !== generation.current
          || !desiredIds.current.has(screenshotId)
        ) {
          URL.revokeObjectURL(url);
          return;
        }
        liveUrls.current.set(screenshotId, url);
        setUrls(current => ({ ...current, [screenshotId]: url }));
      } catch {
        if (mounted.current && expandedRef.current && token === generation.current) {
          markFrameFailed(screenshotId);
        }
      } finally {
        if (inFlight.current.get(screenshotId)?.token === requestToken) {
          inFlight.current.delete(screenshotId);
        }
      }
    })();
    inFlight.current.set(screenshotId, { promise: pending, token: requestToken });
    return pending;
  }, [client, failedIds, markFrameFailed]);

  const expand = async () => {
    const token = ++generation.current;
    expandedRef.current = true;
    setExpanded(true);
    setError('');
    if (index) return;
    try {
      const response = await client.queryScreenshotIndex();
      if (!mounted.current || !expandedRef.current || token !== generation.current) return;
      if (response.type === 'screenshot-index-result') setIndex(response);
      else if (response.type === 'capability-missing') setError(response.reason);
      else setError('截图索引查询失败，Timeline 仍可继续使用。');
    } catch {
      if (mounted.current && expandedRef.current && token === generation.current) {
        setError('截图索引查询失败，Timeline 仍可继续使用。');
      }
    }
  };

  const collapse = () => {
    generation.current += 1;
    expandedRef.current = false;
    clearPlaybackTimer();
    desiredIds.current.clear();
    inFlight.current.clear();
    setPlaying(false);
    setEnlargedId(undefined);
    releaseUrls();
    setExpanded(false);
  };

  const rejectDecodedFrame = (screenshotId: string) => {
    const url = liveUrls.current.get(screenshotId);
    if (url) URL.revokeObjectURL(url);
    liveUrls.current.delete(screenshotId);
    desiredIds.current.delete(screenshotId);
    setUrls(currentUrls => {
      const next = { ...currentUrls };
      delete next[screenshotId];
      return next;
    });
    markFrameFailed(screenshotId);
  };

  const selectFrame = useCallback((nextIndex: number, notify = true) => {
    const boundedIndex = Math.max(0, Math.min(orderedScreenshots.length - 1, nextIndex));
    const frame = orderedScreenshots[boundedIndex];
    if (!frame) return;
    setCurrentIndex(boundedIndex);
    setCursorUs(frame.timestampUs);
    setPage(Math.floor(boundedIndex / SCREENSHOTS_PER_PAGE));
    if (notify) (onCursorTimestamp ?? onSelectTimestamp)?.(frame.timestampUs);
  }, [onCursorTimestamp, onSelectTimestamp, orderedScreenshots]);

  useEffect(() => {
    if (!expanded || orderedScreenshots.length === 0) return;
    const externalTimestamp = hoveredTimestampUs ?? focusedTimestampUs;
    if (externalTimestamp === undefined) {
      lastExternalTimestamp.current = undefined;
      return;
    }
    if (playing) return;
    if (externalTimestamp === lastExternalTimestamp.current) return;
    lastExternalTimestamp.current = externalTimestamp;
    const nextIndex = nearestFrameIndex(orderedScreenshots, externalTimestamp);
    selectFrame(nextIndex, false);
    setCursorUs(externalTimestamp);
  }, [
    expanded,
    focusedTimestampUs,
    hoveredTimestampUs,
    orderedScreenshots,
    playing,
    selectFrame,
  ]);

  useEffect(() => {
    if (!expanded || orderedScreenshots.length === 0) return;
    const nextDesired = new Set(
      orderedScreenshots
        .slice(
          Math.max(0, currentIndex - PRELOAD_RADIUS),
          currentIndex + PRELOAD_RADIUS + 1,
        )
        .map(item => item.screenshotId),
    );
    if (enlargedId) nextDesired.add(enlargedId);
    desiredIds.current = nextDesired;
    for (const [id, url] of liveUrls.current.entries()) {
      if (nextDesired.has(id)) continue;
      URL.revokeObjectURL(url);
      liveUrls.current.delete(id);
      setUrls(current => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
    nextDesired.forEach(id => { void loadScreenshot(id); });
  }, [currentIndex, enlargedId, expanded, loadScreenshot, orderedScreenshots]);

  useEffect(() => {
    clearPlaybackTimer();
    if (!playing || currentIndex >= orderedScreenshots.length - 1) {
      if (playing && currentIndex >= orderedScreenshots.length - 1) setPlaying(false);
      return undefined;
    }
    const current = orderedScreenshots[currentIndex];
    const next = orderedScreenshots[currentIndex + 1];
    const delayMs = Math.max(0, (next.timestampUs - current.timestampUs) / 1_000 / speed);
    playbackTimer.current = window.setTimeout(() => {
      playbackTimer.current = undefined;
      selectFrame(currentIndex + 1);
    }, delayMs);
    return clearPlaybackTimer;
  }, [
    clearPlaybackTimer,
    currentIndex,
    orderedScreenshots,
    playing,
    selectFrame,
    speed,
  ]);

  useEffect(() => {
    if (enlargedId) closeDialogButton.current?.focus();
  }, [enlargedId]);

  const visibleScreenshots = orderedScreenshots.slice(
    page * SCREENSHOTS_PER_PAGE,
    (page + 1) * SCREENSHOTS_PER_PAGE,
  );
  const current = orderedScreenshots[currentIndex];
  const currentUrl = current ? urls[current.screenshotId] : undefined;
  const rangeStartUs = captureRange?.startUs ?? orderedScreenshots[0]?.timestampUs ?? 0;
  const rangeEndUs = captureRange?.endUs
    ?? orderedScreenshots[orderedScreenshots.length - 1]?.timestampUs
    ?? rangeStartUs;
  const enlargedFrame = orderedScreenshots.find(
    item => item.screenshotId === enlargedId,
  );
  const closeEnlarged = () => {
    setEnlargedId(undefined);
    dialogTrigger.current?.focus();
    dialogTrigger.current = undefined;
  };
  const openEnlarged = (screenshotId: string, trigger: HTMLButtonElement) => {
    setPlaying(false);
    dialogTrigger.current = trigger;
    setEnlargedId(screenshotId);
  };
  const togglePlayback = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (currentIndex >= orderedScreenshots.length - 1) selectFrame(0);
    setPlaying(true);
  };

  if (screenshotCount === 0) {
    return (
      <section className="trace-filmstrip is-unavailable" aria-label="截图胶片">
        <strong>截图胶片</strong>
        <p>录制文件未包含截图数据，无法播放历史画面。Timeline 其他轨道不受影响。</p>
      </section>
    );
  }

  return (
    <section className="trace-filmstrip" aria-labelledby="trace-filmstrip-heading">
      <div className="trace-filmstrip-heading">
        <div>
          <strong id="trace-filmstrip-heading">截图胶片</strong>
          <span>只播放 Trace 实际记录的离散截图，不生成中间画面。</span>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? '折叠截图胶片并释放内存' : '展开截图胶片'}
          onClick={expanded ? collapse : expand}
        >
          {expanded ? '折叠并释放' : `展开 ${screenshotCount} 帧`}
        </button>
      </div>
      {expanded && !index && !error ? <p role="status">正在读取截图索引…</p> : null}
      {expanded && index ? (
        <div
          className="trace-filmstrip-player"
          role="region"
          aria-label="截图播放控制"
          tabIndex={0}
          onKeyDown={event => {
            if (event.target !== event.currentTarget) return;
            if (event.key === ' ') {
              event.preventDefault();
              togglePlayback();
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault();
              setPlaying(false);
              selectFrame(currentIndex - 1);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              setPlaying(false);
              selectFrame(currentIndex + 1);
            }
          }}
        >
          {index.rejectedCount > 0 ? (
            <p role="status">{index.rejectedCount} 帧因损坏、重复或预算限制未载入。</p>
          ) : null}
          {orderedScreenshots.length === 0 ? (
            <p className="trace-result-note">截图索引为空，无法播放历史画面。</p>
          ) : (
            <>
              <div className="trace-filmstrip-stage">
                {currentUrl ? (
                  <button
                    type="button"
                    className="trace-filmstrip-current"
                    aria-label="查看当前截图大图"
                    onClick={event => {
                      openEnlarged(current.screenshotId, event.currentTarget);
                    }}
                  >
                    <img
                      alt={`当前录制截图，时间 ${(current.timestampUs / 1_000_000).toFixed(2)} 秒`}
                      onError={() => rejectDecodedFrame(current.screenshotId)}
                      src={currentUrl}
                    />
                  </button>
                ) : failedIds.includes(current.screenshotId) ? (
                  <p role="status">当前截图解码失败，可继续检查其他帧。</p>
                ) : (
                  <p role="status">正在载入当前截图…</p>
                )}
                <div className="trace-filmstrip-time">
                  <strong>{((cursorUs ?? current.timestampUs) / 1_000_000).toFixed(2)} 秒</strong>
                  <span>
                    {(rangeStartUs / 1_000_000).toFixed(2)} 秒
                    {' – '}
                    {(rangeEndUs / 1_000_000).toFixed(2)} 秒
                  </span>
                </div>
              </div>

              <div className="trace-filmstrip-controls" role="toolbar" aria-label="截图播放工具栏">
                <button type="button" aria-label="上一帧" disabled={currentIndex === 0} onClick={() => { setPlaying(false); selectFrame(currentIndex - 1); }}>上一帧</button>
                <button type="button" aria-label={playing ? '暂停截图' : '播放截图'} onClick={togglePlayback}>
                  {playing ? '暂停' : '播放'}
                </button>
                <button type="button" aria-label="下一帧" disabled={currentIndex === orderedScreenshots.length - 1} onClick={() => { setPlaying(false); selectFrame(currentIndex + 1); }}>下一帧</button>
                <div className="trace-filmstrip-speeds" aria-label="播放速度">
                  {PLAYBACK_SPEEDS.map(value => (
                    <button
                      type="button"
                      aria-pressed={speed === value}
                      key={value}
                      onClick={() => setSpeed(value)}
                    >
                      {value}×
                    </button>
                  ))}
                </div>
              </div>

              <label className="trace-filmstrip-scrubber">
                <span>时间游标</span>
                <input
                  aria-label="截图时间游标"
                  type="range"
                  min={rangeStartUs}
                  max={rangeEndUs}
                  step={1}
                  value={cursorUs ?? current.timestampUs}
                  onChange={event => {
                    const timestampUs = Number(event.currentTarget.value);
                    setPlaying(false);
                    setCursorUs(timestampUs);
                    selectFrame(nearestFrameIndex(orderedScreenshots, timestampUs), false);
                    setCursorUs(timestampUs);
                    (onCursorTimestamp ?? onSelectTimestamp)?.(timestampUs);
                  }}
                />
              </label>

              <ol className="trace-filmstrip-list">
                {visibleScreenshots.map(summary => {
                  const absoluteIndex = orderedScreenshots.findIndex(
                    item => item.screenshotId === summary.screenshotId,
                  );
                  const seconds = (summary.timestampUs / 1_000_000).toFixed(2);
                  const alt = `录制截图，时间 ${seconds} 秒`;
                  const url = urls[summary.screenshotId];
                  const selected = absoluteIndex === currentIndex;
                  return (
                    <li className={selected ? 'is-current' : undefined} key={summary.screenshotId}>
                      <button
                        type="button"
                        className="trace-filmstrip-frame"
                        aria-current={selected ? 'true' : undefined}
                        aria-label={`${url ? '查看' : '加载'}${alt}`}
                        onClick={event => {
                          selectFrame(absoluteIndex, false);
                          onSelectTimestamp?.(summary.timestampUs);
                          if (url) {
                            openEnlarged(summary.screenshotId, event.currentTarget);
                          }
                        }}
                      >
                        {url ? (
                          <img
                            alt={alt}
                            onError={() => rejectDecodedFrame(summary.screenshotId)}
                            src={url}
                          />
                        ) : <span>载入帧</span>}
                        <time>{seconds}s</time>
                      </button>
                    </li>
                  );
                })}
              </ol>
              {orderedScreenshots.length > SCREENSHOTS_PER_PAGE ? (
                <nav className="trace-filmstrip-pagination" aria-label="截图分页">
                  <button type="button" disabled={page === 0} onClick={() => setPage(value => Math.max(0, value - 1))}>上一页</button>
                  <span>第 {page + 1} / {Math.ceil(orderedScreenshots.length / SCREENSHOTS_PER_PAGE)} 页</span>
                  <button type="button" disabled={(page + 1) * SCREENSHOTS_PER_PAGE >= orderedScreenshots.length} onClick={() => setPage(value => value + 1)}>下一页</button>
                </nav>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {enlargedId && enlargedFrame && urls[enlargedId] ? (
        <div
          className="trace-filmstrip-dialog"
          role="dialog"
          aria-label={`录制截图，时间 ${(enlargedFrame.timestampUs / 1_000_000).toFixed(2)} 秒`}
          aria-modal="true"
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeEnlarged();
            } else if (event.key === 'Tab') {
              event.preventDefault();
              closeDialogButton.current?.focus();
            }
          }}
        >
          <img alt="当前截图大图" src={urls[enlargedId]} />
          <button
            ref={closeDialogButton}
            type="button"
            aria-label="关闭截图大图"
            onClick={() => {
              closeEnlarged();
            }}
          >
            关闭
          </button>
        </div>
      ) : null}
      {error ? <p className="trace-export-error" role="alert">{error}</p> : null}
    </section>
  );
};

export default ScreenshotFilmstrip;
