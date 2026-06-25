import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Input, List, Tag, Button, message, Divider, Typography, Spin, Empty } from 'antd';
import { SearchOutlined, CopyOutlined, FileSearchOutlined } from '@ant-design/icons';
import type { JsonPathMatch, StructureNode } from '../../parsers/shared/rawJsonPath';
import { copyText } from '../../utils/copyText';
import { getRawStructureInWorker, getRawValueInWorker, isWorkerSupported, searchRawJsonInWorker } from '../../workers/workerClient';
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
  /**
   * rawData 在 Worker 内的缓存 ID
   * 重要：性能专项要求主线程不持有 rawData，所有查询都通过 rawDataId
   */
  rawDataId: string;
  /** 文件名 */
  fileName?: string;
}

const { Text } = Typography;

const RawEvidenceExplorer: React.FC<RawEvidenceExplorerProps> = ({ rawDataId, fileName }) => {
  const [structure, setStructure] = useState<StructureNode[]>([]);
  const [structureLoading, setStructureLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<JsonPathMatch[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedValue, setExpandedValue] = useState<string | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchTaskIdRef = useRef(0);
  const pendingSelectPathRef = useRef<string | null>(null);

  const { intent, consumeIntent } = useNavigation();

  const loadStructure = useCallback(async () => {
    if (!rawDataId) return;
    if (!isWorkerSupported()) {
      message.warning('当前环境不支持 Worker，原始证据功能不可用');
      return;
    }
    setStructureLoading(true);
    try {
      const nodes = await getRawStructureInWorker(rawDataId, { maxDepth: RAW_EVIDENCE_STRUCTURE_OVERVIEW_MAX_DEPTH, timeout: RAW_EVIDENCE_WORKER_TIMEOUT_MS });
      setStructure(nodes || []);
    } catch {
      setStructure([]);
    } finally {
      setStructureLoading(false);
    }
  }, [rawDataId]);

  useEffect(() => {
    void loadStructure();
  }, [loadStructure]);

  const handleSearch = useCallback((query: string) => {
    const q = query.trim();
    setSearchQuery(query);
    if (searchTimer.current) clearTimeout(searchTimer.current);

    searchTimer.current = setTimeout(() => {
      const taskId = ++searchTaskIdRef.current;
      if (!q) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }
      setIsSearching(true);

      const run = async () => {
        try {
          const results = await searchRawJsonInWorker(rawDataId, q, {
            timeout: RAW_EVIDENCE_WORKER_TIMEOUT_MS,
            maxResults: RAW_EVIDENCE_SEARCH_MAX_RESULTS,
            maxDepth: RAW_EVIDENCE_SEARCH_MAX_DEPTH,
          });
          if (taskId !== searchTaskIdRef.current) return;
          setSearchResults(results);
          setIsSearching(false);
        } catch {
          if (taskId !== searchTaskIdRef.current) return;
          setSearchResults([]);
          setIsSearching(false);
          message.error('搜索失败');
        }
      };
      void run();
    }, SEARCH_DEBOUNCE_MS);
  }, [rawDataId]);

  const handleSelectPath = useCallback(async (path: string) => {
    setSelectedPath(path);
    setExpandedValue('加载中...');
    try {
      const value = await getRawValueInWorker(rawDataId, path, {
        maxChars: RAW_EVIDENCE_VALUE_PREVIEW_MAX_CHARS,
        timeout: RAW_EVIDENCE_WORKER_TIMEOUT_MS,
      });
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      setExpandedValue(text);
    } catch {
      setExpandedValue('读取失败');
    }
  }, [rawDataId]);

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

  // 如果 intent 传入的是一个精确 fieldPath，且搜索结果包含该 path，则自动选中
  useEffect(() => {
    const wanted = pendingSelectPathRef.current;
    if (!wanted) return;
    const hit = searchResults.find(r => r.path === wanted);
    if (!hit) return;
    pendingSelectPathRef.current = null;
    void handleSelectPath(hit.path);
  }, [searchResults, handleSelectPath]);

  const structureItems = useMemo(() => structure.slice(0, 200), [structure]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}
        bodyStyle={{ padding: 16 }}
        title={<span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><FileSearchOutlined /> 原始证据{fileName ? `：${fileName}` : ''}</span>}
        extra={<Button size="small" onClick={() => void loadStructure()}>刷新结构</Button>}
      >
        <Input
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索 JSON Path / 字段名 / 值片段（Worker 执行）"
        />
        <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 12 }}>
          提示：为避免主线程卡顿，RawEvidence 已强制使用 Worker 查询；返回结果与预览均有上限。
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Card
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}
          bodyStyle={{ padding: 12 }}
          title="结构概览"
        >
          {structureLoading ? (
            <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><Spin /></div>
          ) : structureItems.length === 0 ? (
            <Empty description="无结构数据" />
          ) : (
            <List
              size="small"
              dataSource={structureItems}
              renderItem={(n) => (
                <List.Item
                  style={{ cursor: 'pointer' }}
                  onClick={() => void handleSelectPath(n.path)}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <Text code style={{ fontSize: 12 }}>{n.path || '$'}</Text>
                      <Tag style={{ margin: 0 }}>{n.type}</Tag>
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {n.preview}
                    </div>
                  </div>
                </List.Item>
              )}
            />
          )}
        </Card>

        <Card
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12 }}
          bodyStyle={{ padding: 12 }}
          title="搜索结果 / 字段值"
          extra={selectedPath ? (
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={async () => {
                if (!expandedValue) return;
                await copyText(expandedValue);
              }}
            >
              复制值
            </Button>
          ) : null}
        >
          {isSearching ? (
            <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><Spin /></div>
          ) : searchQuery.trim() && searchResults.length > 0 ? (
            <>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>
                命中 {searchResults.length} 条（最多 {RAW_EVIDENCE_SEARCH_MAX_RESULTS} 条）
              </div>
              <List
                size="small"
                dataSource={searchResults}
                renderItem={(r) => (
                  <List.Item style={{ cursor: 'pointer' }} onClick={() => void handleSelectPath(r.path)}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <Text code style={{ fontSize: 12 }}>{r.path}</Text>
                        <Tag style={{ margin: 0 }}>{r.type}</Tag>
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        {(() => {
                          const s = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
                          return s.length > 240 ? `${s.slice(0, 240)}...(截断)` : s;
                        })()}
                      </div>
                    </div>
                  </List.Item>
                )}
              />
              <Divider style={{ margin: '12px 0' }} />
            </>
          ) : selectedPath ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>
              当前字段：<Text code>{selectedPath}</Text>
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>请选择结构节点或先搜索。</div>
          )}

          {expandedValue && (
            <pre style={{ maxHeight: 520, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {expandedValue}
            </pre>
          )}
        </Card>
      </div>
    </div>
  );
};

export default RawEvidenceExplorer;
