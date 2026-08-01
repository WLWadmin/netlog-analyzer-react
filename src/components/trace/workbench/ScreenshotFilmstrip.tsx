import {
  useCallback,
  useEffect,
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
  hoveredTimestampUs?: number;
  onSelectTimestamp?(timestampUs: number): void;
}

const SCREENSHOTS_PER_PAGE = 100;

const ScreenshotFilmstrip: React.FC<ScreenshotFilmstripProps> = ({
  client,
  screenshotCount,
  captureRange,
  hoveredTimestampUs,
  onSelectTimestamp,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [index, setIndex] = useState<ScreenshotIndexResultResponse>();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [enlargedId, setEnlargedId] = useState<string>();
  const [page, setPage] = useState(0);
  const liveUrls = useRef(new Map<string, string>());
  const inFlight = useRef(new Map<string, Promise<void>>());
  const frameButtons = useRef(new Map<string, HTMLButtonElement>());
  const mounted = useRef(true);
  const expandedRef = useRef(false);
  const generation = useRef(0);
  const closeDialogButton = useRef<HTMLButtonElement>(null);

  const releaseUrls = () => {
    for (const url of liveUrls.current.values()) URL.revokeObjectURL(url);
    liveUrls.current.clear();
    if (mounted.current) setUrls({});
  };

  useEffect(() => {
    mounted.current = true;
    const urlsToRelease = liveUrls.current;
    const pendingRequests = inFlight.current;
    return () => {
      mounted.current = false;
      expandedRef.current = false;
      generation.current += 1;
      for (const url of urlsToRelease.values()) URL.revokeObjectURL(url);
      urlsToRelease.clear();
      pendingRequests.clear();
    };
  }, []);

  const expand = async () => {
    const token = ++generation.current;
    expandedRef.current = true;
    setExpanded(true);
    setError('');
    if (index) return;
    try {
      const response = await client.queryScreenshotIndex();
      if (
        !mounted.current
        || !expandedRef.current
        || token !== generation.current
      ) return;
      if (response.type === 'screenshot-index-result') setIndex(response);
      else if (response.type === 'capability-missing') setError(response.reason);
      else setError('截图索引查询失败，Timeline 仍可继续使用。');
    } catch {
      if (
        mounted.current
        && expandedRef.current
        && token === generation.current
      ) {
        setError('截图索引查询失败，Timeline 仍可继续使用。');
      }
    }
  };

  const collapse = () => {
    generation.current += 1;
    expandedRef.current = false;
    setEnlargedId(undefined);
    releaseUrls();
    setExpanded(false);
  };

  const loadScreenshot = useCallback((screenshotId: string): Promise<void> => {
    if (liveUrls.current.has(screenshotId) || failedIds.includes(screenshotId)) {
      return Promise.resolve();
    }
    const existing = inFlight.current.get(screenshotId);
    if (existing) return existing;
    const token = generation.current;
    const pending = (async () => {
      setError('');
      try {
        const response = await client.queryScreenshot(screenshotId);
        if (response.type !== 'screenshot-result') {
          if (
            mounted.current
            && expandedRef.current
            && token === generation.current
          ) {
            setFailedIds(current => (
              current.includes(screenshotId) ? current : [...current, screenshotId]
            ));
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
        ) {
          URL.revokeObjectURL(url);
          return;
        }
        liveUrls.current.set(screenshotId, url);
        setUrls(current => ({ ...current, [screenshotId]: url }));
      } catch {
        if (
          mounted.current
          && expandedRef.current
          && token === generation.current
        ) {
          setFailedIds(current => (
            current.includes(screenshotId) ? current : [...current, screenshotId]
          ));
        }
      } finally {
        inFlight.current.delete(screenshotId);
      }
    })();
    inFlight.current.set(screenshotId, pending);
    return pending;
  }, [client, failedIds]);

  useEffect(() => {
    if (enlargedId) closeDialogButton.current?.focus();
  }, [enlargedId]);

  const visibleScreenshots = index?.screenshots.slice(
    page * SCREENSHOTS_PER_PAGE,
    (page + 1) * SCREENSHOTS_PER_PAGE,
  ) ?? [];
  const nearestScreenshot = hoveredTimestampUs === undefined || !index
    ? undefined
    : index.screenshots.reduce<{
        id: string;
        distance: number;
        index: number;
      } | undefined>((nearest, candidate, candidateIndex) => {
        const distance = Math.abs(candidate.timestampUs - hoveredTimestampUs);
        return !nearest || distance < nearest.distance
          ? { id: candidate.screenshotId, distance, index: candidateIndex }
          : nearest;
      }, undefined);
  const nearestScreenshotId = nearestScreenshot?.id;
  const nearestScreenshotPage = nearestScreenshot
    ? Math.floor(nearestScreenshot.index / SCREENSHOTS_PER_PAGE)
    : undefined;

  useEffect(() => {
    if (!expanded || !nearestScreenshotId) return undefined;
    if (nearestScreenshotPage !== undefined) setPage(nearestScreenshotPage);
    const timer = window.setTimeout(() => {
      void loadScreenshot(nearestScreenshotId);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [expanded, loadScreenshot, nearestScreenshotId, nearestScreenshotPage]);

  if (screenshotCount === 0) {
    return (
      <section className="trace-filmstrip is-unavailable" aria-label="截图胶片">
        <strong>Screenshot Filmstrip</strong>
        <p>录制文件未包含截图数据。Timeline 其他轨道不受影响。</p>
      </section>
    );
  }

  return (
    <section className="trace-filmstrip" aria-labelledby="trace-filmstrip-heading">
      <div className="trace-filmstrip-heading">
        <div>
          <strong id="trace-filmstrip-heading">Screenshot Filmstrip</strong>
          <span>截图仅存在于当前 Worker 会话，不进入诊断或导出。</span>
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
      {expanded && !index && !error && <p role="status">正在读取截图索引…</p>}
      {expanded && index && (
        <>
          {index.rejectedCount > 0 && (
            <p role="status">
              {index.rejectedCount} 帧因损坏、重复或预算限制未载入。
            </p>
          )}
          <ol className="trace-filmstrip-list">
            {visibleScreenshots.map(summary => {
              const seconds = (summary.timestampUs / 1_000_000).toFixed(2);
              const alt = `录制截图，时间 ${seconds} 秒`;
              const url = urls[summary.screenshotId];
              const position = captureRange
                && captureRange.endUs > captureRange.startUs
                ? (
                    (summary.timestampUs - captureRange.startUs)
                    / (captureRange.endUs - captureRange.startUs)
                  ) * 100
                : undefined;
              return (
                <li
                  key={summary.screenshotId}
                  className={nearestScreenshot?.id === summary.screenshotId
                    ? 'is-nearest'
                    : undefined}
                  style={position === undefined
                    ? undefined
                    : { '--filmstrip-position': `${Math.max(0, Math.min(100, position))}%` } as React.CSSProperties}
                >
                  {url ? (
                    <button
                      type="button"
                      className="trace-filmstrip-frame"
                      aria-label={`查看${alt}`}
                      ref={element => {
                        if (element) frameButtons.current.set(summary.screenshotId, element);
                        else frameButtons.current.delete(summary.screenshotId);
                      }}
                      onClick={() => {
                        onSelectTimestamp?.(summary.timestampUs);
                        setEnlargedId(summary.screenshotId);
                      }}
                    >
                      <img
                        alt={alt}
                        src={url}
                        onError={() => {
                          URL.revokeObjectURL(url);
                          liveUrls.current.delete(summary.screenshotId);
                          setUrls(current => {
                            const next = { ...current };
                            delete next[summary.screenshotId];
                            return next;
                          });
                          setFailedIds(current => [...current, summary.screenshotId]);
                        }}
                      />
                      <span>{seconds}s</span>
                    </button>
                  ) : failedIds.includes(summary.screenshotId) ? (
                    <span role="status">截图 {seconds}s 解码失败</span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`加载${alt}`}
                      onClick={() => {
                        onSelectTimestamp?.(summary.timestampUs);
                        void loadScreenshot(summary.screenshotId);
                      }}
                    >
                      加载 {seconds}s
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {index.screenshots.length > SCREENSHOTS_PER_PAGE && (
            <nav className="trace-filmstrip-pagination" aria-label="截图分页">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage(value => Math.max(0, value - 1))}
              >
                上一页
              </button>
              <span>
                第 {page + 1} / {Math.ceil(index.screenshots.length / SCREENSHOTS_PER_PAGE)} 页
              </span>
              <button
                type="button"
                disabled={(page + 1) * SCREENSHOTS_PER_PAGE >= index.screenshots.length}
                onClick={() => setPage(value => value + 1)}
              >
                下一页
              </button>
            </nav>
          )}
          {enlargedId && urls[enlargedId] && (() => {
            const summary = index.screenshots.find(item => item.screenshotId === enlargedId);
            if (!summary) return null;
            const seconds = (summary.timestampUs / 1_000_000).toFixed(2);
            const alt = `录制截图，时间 ${seconds} 秒`;
            return (
              <div
                className="trace-filmstrip-dialog"
                role="dialog"
                aria-label={alt}
                aria-modal="true"
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setEnlargedId(undefined);
                    frameButtons.current.get(enlargedId)?.focus();
                  } else if (event.key === 'Tab') {
                    event.preventDefault();
                    closeDialogButton.current?.focus();
                  }
                }}
              >
                <img alt={alt} src={urls[enlargedId]} />
                <button
                  ref={closeDialogButton}
                  type="button"
                  aria-label="关闭截图大图"
                  onClick={() => {
                    setEnlargedId(undefined);
                    frameButtons.current.get(enlargedId)?.focus();
                  }}
                >
                  关闭
                </button>
              </div>
            );
          })()}
        </>
      )}
      {error && <p className="trace-export-error" role="alert">{error}</p>}
    </section>
  );
};

export default ScreenshotFilmstrip;
