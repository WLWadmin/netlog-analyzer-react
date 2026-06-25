/**
 * RawEvidenceExplorer - 原始 JSON 证据浏览器
 * 支持对原始上传文件进行路径搜索和结构探索
 *
 * 性能策略：
 * - 默认在 Worker 中执行深度搜索，避免主线程递归扫描大 JSON
 * - Worker 不可用或失败时降级到主线程搜索（仍限制 maxResults/maxDepth）
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Card, Input, Button, Tag, Empty, Tooltip, message } from 'antd';
import {
  SearchOutlined,
  CopyOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import { searchJsonPaths, getStructureOverview, getValueByPath, JsonPathMatch, StructureNode } from '../../parsers/shared/rawJsonPath';
import { copyText } from '../../utils/copyText';
import {
  getRawStructureInWorker,
  getRawValueInWorker,
  isWorkerSupported,
  searchRawJsonInWorker,
} from '../../workers/workerClient';
import { useNavigation } from '../../contexts/NavigationContext';
import {
  RAW_EVIDENCE_SEARCH_MAX_DEPTH,
  RAW_EVIDENCE_SEARCH_MAX_RESULTS,
  RAW_EVIDENCE_STRUCTURE_OVERVIEW_MAX_DEPTH,
  RAW_EVIDENCE_VALUE_PREVIEW_MAX_CHARS,
  RAW_EVIDENCE_WORKER_TIMEOUT_MS,
  SEARCH_DEBOUNCE_MS,
} from '../../constants/analysisThresholds';

interface RawEvidenceExplorerProps {
  /** 原始 JSON 数据（上传的文件内容） */
  rawData?: unknown;
  /**
   * rawData 在 Worker 内的缓存 ID
   * 有该值时，搜索必须走 `rawDataId`（避免 structured clone 大 JSON）
   */
  rawDataId?: string;
  /** 文件名 */
  fileName?: string;
}

const RawEvidenceExplorer: React.FC<RawEvidenceExplorerProps> = ({ rawData, rawDataId, fileName }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<JsonPathMatch[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedValue, setExpandedValue] = useState<string | null>(null);
  const [workerStructure, setWorkerStructure] = useState<StructureNode[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchTaskIdRef = useRef(0);
  const pendingSelectPathRef = useRef<string | null>(null);
  const { intent, consumeIntent } = useNavigation();

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  const fallbackStructure = useMemo(
    () => rawData ? getStructureOverview(rawData, RAW_EVIDENCE_STRUCTURE_OVERVIEW_MAX_DEPTH) : [],
    [rawData]
  );
  const structure = rawDataId ? workerStructure : fallbackStructure;

  useEffect(() => {
    let cancelled = false;
    if (!rawDataId) {
      setWorkerStructure([]);
      return;
    }

    getRawStructureInWorker(rawDataId, {
      timeout: RAW_EVIDENCE_WORKER_TIMEOUT_MS,
      maxDepth: RAW_EVIDENCE_STRUCTURE_OVERVIEW_MAX_DEPTH,
    })
      .then((nextStructure) => {
        if (!cancelled) setWorkerStructure(nextStructure);
      })
      .catch(() => {
        if (!cancelled) {
          setWorkerStructure([]);
          if (rawData) {
            message.warning('Worker 结构读取失败，已降级到主线程结构预览');
          } else {
            message.error('原始 JSON 结构读取失败，请重新上传文件');
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rawDataId, rawData]);

  const readValuePreview = useCallback(async (path: string): Promise<string> => {
    if (isWorkerSupported() && rawDataId) {
      const preview = await getRawValueInWorker(rawDataId, path, {
        timeout: RAW_EVIDENCE_WORKER_TIMEOUT_MS,
        maxChars: RAW_EVIDENCE_VALUE_PREVIEW_MAX_CHARS,
      });
      return preview.text;
    }

    const value = getValueByPath(rawData, path);
    const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
    return text.length > RAW_EVIDENCE_VALUE_PREVIEW_MAX_CHARS
      ? text.slice(0, RAW_EVIDENCE_VALUE_PREVIEW_MAX_CHARS) + '\n...(内容过长已截断)'
      : text;
  }, [rawData, rawDataId]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimer.current) clearTimeout(searchTimer.current);

    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    searchTimer.current = setTimeout(() => {
      const taskId = ++searchTaskIdRef.current;
      const q = query.trim();

      const run = async () => {
        try {
          if (isWorkerSupported() && rawDataId) {
            const results = await searchRawJsonInWorker(rawDataId, q, {
              timeout: RAW_EVIDENCE_WORKER_TIMEOUT_MS,
              maxResults: RAW_EVIDENCE_SEARCH_MAX_RESULTS,
              maxDepth: RAW_EVIDENCE_SEARCH_MAX_DEPTH,
            });
            if (taskId !== searchTaskIdRef.current) return;
            setSearchResults(results);
            setIsSearching(false);
            return;
          }

          // Worker 不支持或缺少 rawDataId：降级主线程搜索
          if (!rawData) {
            setSearchResults([]);
            setIsSearching(false);
            message.error('原始 JSON 未在主线程保留，请重新上传文件后重试');
            return;
          }
          const results = searchJsonPaths(rawData, q, RAW_EVIDENCE_SEARCH_MAX_RESULTS, RAW_EVIDENCE_SEARCH_MAX_DEPTH);
          if (taskId !== searchTaskIdRef.current) return;
          setSearchResults(results);
          setIsSearching(false);
        } catch (err) {
          // Worker 搜索失败：降级主线程搜索（避免功能不可用）
          try {
            if (!rawData) {
              if (taskId !== searchTaskIdRef.current) return;
              setSearchResults([]);
              setIsSearching(false);
              message.error('Worker 搜索失败，请重新上传文件后重试');
              return;
            }
            const results = searchJsonPaths(rawData, q, RAW_EVIDENCE_SEARCH_MAX_RESULTS, RAW_EVIDENCE_SEARCH_MAX_DEPTH);
            if (taskId !== searchTaskIdRef.current) return;
            setSearchResults(results);
            setIsSearching(false);
            message.warning('Worker 搜索失败，已降级到主线程搜索（大文件可能卡顿）');
          } catch {
            if (taskId !== searchTaskIdRef.current) return;
            setSearchResults([]);
            setIsSearching(false);
            message.error('搜索失败');
          }
        }
      };

      void run();
    }, SEARCH_DEBOUNCE_MS);
  }, [rawData, rawDataId]);

  // 消费导航意图：支持从诊断卡一键跳到 raw-evidence，并自动执行搜索
  useEffect(() => {
    if (!intent || intent.tab !== 'raw-evidence') return;
    const q = intent.filters?.paramField || intent.filters?.keyword || '';
    if (q) {
      pendingSelectPathRef.current = q;
      handleSearch(q);
    }
    consumeIntent();
  }, [intent, consumeIntent, handleSearch]);

  // 如果 intent 传入的是一个精确 fieldPath（如 $.log.entries[0].request.url），且搜索结果包含该 path，则自动选中
  useEffect(() => {
    const wanted = pendingSelectPathRef.current;
    if (!wanted) return;
    const hit = searchResults.find(r => r.path === wanted);
    if (!hit) return;
    pendingSelectPathRef.current = null;
    setSelectedPath(hit.path);
    void readValuePreview(hit.path)
      .then(setExpandedValue)
      .catch(() => message.error('字段值读取失败'));
  }, [searchResults, readValuePreview]);

  const handleCopyPath = async (path: string) => {
    try {
      await copyText(path);
      message.success('路径已复制');
    } catch {
      message.error('复制失败');
    }
  };

  const handleCopyValue = async (value: unknown) => {
    try {
      const text = expandedValue ?? (typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value));
      await copyText(text);
      message.success('值已复制');
    } catch {
      message.error('复制失败');
    }
  };

  const handleSelectPath = (path: string) => {
    setSelectedPath(path);
    setExpandedValue('读取中...');
    void readValuePreview(path)
      .then(setExpandedValue)
      .catch(() => {
        setExpandedValue(null);
        message.error('字段值读取失败');
      });
  };

  if (!rawData && !rawDataId) {
    return (
      <Card>
        <Empty description="暂无原始数据可浏览" />
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <Card size="small" bodyStyle={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <FileSearchOutlined style={{ fontSize: 16, color: '#6366f1' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            原始证据浏览器
          </span>
          {fileName && (
            <Tag style={{ margin: 0 }}>{fileName}</Tag>
          )}
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            输入字段名或值进行搜索（如 net_error、ERR_、dns、timeout）
          </span>
        </div>
      </Card>

      {/* Search */}
      <Input
        size="large"
        prefix={<SearchOutlined />}
        placeholder="搜索字段名或值... (如: net_error, proxy, certificate, source_dependency)"
        value={searchQuery}
        onChange={e => handleSearch(e.target.value)}
        allowClear
        style={{ borderRadius: 10 }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minHeight: 400 }}>
        {/* Left: Results / Structure */}
        <Card
          size="small"
          title={searchQuery ? `搜索结果 (${searchResults.length})` : '文件结构'}
          bodyStyle={{ padding: 0, maxHeight: 600, overflow: 'auto' }}
        >
          {searchQuery ? (
            searchResults.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                {isSearching ? '搜索中...' : '未找到匹配结果'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {searchResults.map((match, i) => (
                  <PathResultItem
                    key={`${match.path}-${i}`}
                    match={match}
                    isSelected={selectedPath === match.path}
                    onClick={() => handleSelectPath(match.path)}
                    onCopyPath={() => handleCopyPath(match.path)}
                  />
                ))}
              </div>
            )
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {structure.map((node, i) => (
                <StructureItem
                  key={`${node.path}-${i}`}
                  node={node}
                  onClick={() => handleSelectPath(node.path)}
                  isSelected={selectedPath === node.path}
                />
              ))}
            </div>
          )}
        </Card>

        {/* Right: Value Preview */}
        <Card
          size="small"
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>值预览</span>
              {selectedPath && (
                <Tag style={{ margin: 0, fontSize: 11, fontFamily: "'SF Mono', monospace" }}>
                  {selectedPath}
                </Tag>
              )}
            </div>
          }
          extra={expandedValue && (
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => handleCopyValue(selectedPath && rawData ? getValueByPath(rawData, selectedPath) : null)}
            >
              复制
            </Button>
          )}
          bodyStyle={{ padding: 0, maxHeight: 600, overflow: 'auto' }}
        >
          {expandedValue ? (
            <pre style={{
              margin: 0,
              padding: 16,
              fontSize: 12,
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: 'var(--text-primary)',
            }}>
              {expandedValue.length > RAW_EVIDENCE_VALUE_PREVIEW_MAX_CHARS
                ? expandedValue.substring(0, RAW_EVIDENCE_VALUE_PREVIEW_MAX_CHARS) + '\n\n... (内容过长，已截断)'
                : expandedValue}
            </pre>
          ) : (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
              点击左侧路径查看对应值
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

// ============ Sub-components ============

function PathResultItem({
  match,
  isSelected,
  onClick,
  onCopyPath,
}: {
  match: JsonPathMatch;
  isSelected: boolean;
  onClick: () => void;
  onCopyPath: () => void;
}) {
  const valuePreview = typeof match.value === 'object'
    ? JSON.stringify(match.value).substring(0, 60)
    : String(match.value).substring(0, 60);

  return (
    <div
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-color)',
        cursor: 'pointer',
        background: isSelected ? 'rgba(99, 102, 241, 0.06)' : 'transparent',
        transition: 'background 0.15s',
      }}
      onClick={onClick}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-elevated)'; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: 12,
          fontFamily: "'SF Mono', monospace",
          color: '#6366f1',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {match.path}
        </span>
        <Tag style={{ margin: 0, fontSize: 10 }}>{match.type}</Tag>
        <Tooltip title="复制路径">
          <Button
            type="text"
            size="small"
            icon={<CopyOutlined />}
            onClick={e => { e.stopPropagation(); onCopyPath(); }}
            style={{ padding: '0 4px' }}
          />
        </Tooltip>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {valuePreview}
      </div>
    </div>
  );
}

function StructureItem({
  node,
  onClick,
  isSelected,
}: {
  node: StructureNode;
  onClick: () => void;
  isSelected: boolean;
}) {
  const indent = node.path ? (node.path.split('.').length - 1) * 16 : 0;

  return (
    <div
      style={{
        padding: '6px 12px',
        paddingLeft: 12 + indent,
        borderBottom: '1px solid var(--border-color)',
        cursor: 'pointer',
        background: isSelected ? 'rgba(99, 102, 241, 0.06)' : 'transparent',
        transition: 'background 0.15s',
      }}
      onClick={onClick}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-elevated)'; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--text-primary)',
        }}>
          {node.key || '(root)'}
        </span>
        <Tag style={{ margin: 0, fontSize: 10 }}>{node.type}</Tag>
        {node.childCount !== undefined && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            ({node.childCount} items)
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {node.preview}
      </div>
    </div>
  );
}

export default RawEvidenceExplorer;
