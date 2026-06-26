import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Alert, Tag, Button, Collapse } from 'antd';
import { DownOutlined, UpOutlined, MedicineBoxOutlined } from '@ant-design/icons';
import { AnalysisResult, ParsedEvent } from '../../parsers/netlog/parser';
import { generateSuggestions } from '../../parsers/netlog/diagnosis';
import { groupIssues, groupByCategory, GroupedIssue, IssueAlert } from '../../components/shared/IssueDisplay';
import { buildFinalDiagnosisSummary, buildNetlogDiagnosisSummary } from '../../diagnosis/shared';
import type { DiagnosisSummary } from '../../diagnosis/shared/types';
import { extractDnsIpEvidenceFromNetlog } from '../../diagnosis/ipEvidence';
import DiagnosisPanel from '../shared/DiagnosisPanel';
import FinalDiagnosisPanel from '../shared/FinalDiagnosisPanel';
import DnsAndIpEvidencePanel from '../shared/DnsAndIpEvidencePanel';

interface DiagnosisTabProps {
  result: AnalysisResult;
  events: ParsedEvent[];
}

interface LegacyDiagnosisData {
  groupedIssues: GroupedIssue[];
  byCategory: Map<string, GroupedIssue[]>;
  categories: Record<string, { errors: number; warnings: number; info: number }>;
}

const DIAGNOSIS_TIMING_DEBUG_KEY = 'diagnosis_debug_timing';

function isDiagnosisTimingDebugEnabled(): boolean {
  try {
    return window.localStorage.getItem(DIAGNOSIS_TIMING_DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}

function recordDiagnosisTiming(
  enabled: boolean,
  rows: { stage: string; durationMs: number; meta?: Record<string, string | number | boolean | undefined> }[],
  stage: string,
  start: number,
  end: number = performance.now(),
  meta?: Record<string, string | number | boolean | undefined>
) {
  if (!enabled) return;
  rows.push({ stage, durationMs: Math.round((end - start) * 10) / 10, meta });
}

function buildLegacyDiagnosisData(result: AnalysisResult): LegacyDiagnosisData {
  const groupedIssues = groupIssues(result.errors, [...result.warnings, ...result.info] as any);
  const byCategory = groupByCategory(groupedIssues);
  const categories: Record<string, { errors: number; warnings: number; info: number }> = {};

  for (const issue of groupedIssues) {
    const cat = issue.category || '未知';
    if (!categories[cat]) categories[cat] = { errors: 0, warnings: 0, info: 0 };
    if (issue.severity === 'error' || issue.severity === 'critical') categories[cat].errors += issue.count;
    else if (issue.severity === 'warning') categories[cat].warnings += issue.count;
    else categories[cat].info += issue.count;
  }

  return { groupedIssues, byCategory, categories };
}

const DiagnosisTab: React.FC<DiagnosisTabProps> = ({ result, events }) => {
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [loadedCategories, setLoadedCategories] = useState<Map<string, number>>(new Map());
  const [diagnosisSummary, setDiagnosisSummary] = useState<DiagnosisSummary | undefined>();
  const [legacyData, setLegacyData] = useState<LegacyDiagnosisData | undefined>();
  const [diagnosisLoading, setDiagnosisLoading] = useState(true);
  const [showExpertDiagnosis, setShowExpertDiagnosis] = useState(false);
  const expertDiagnosisRef = useRef<HTMLDivElement | null>(null);

  const INITIAL_SHOW = 10;
  const LOAD_MORE_STEP = 100;
  const FULL_THRESHOLD = 300;
  const INITIAL_DIAGNOSIS_CARDS = 8;
  const DIAGNOSIS_CARD_LOAD_STEP = 8;

  useEffect(() => {
    let cancelled = false;
    const debugTiming = isDiagnosisTimingDebugEnabled();
    const timingRows: { stage: string; durationMs: number; meta?: Record<string, string | number | boolean | undefined> }[] = [];
    const effectStart = performance.now();
    setDiagnosisLoading(true);
    setDiagnosisSummary(undefined);
    setLegacyData(undefined);
    setExpandedKeys([]);
    setLoadedCategories(new Map());

    const timer = window.setTimeout(() => {
      const handlerStart = performance.now();
      recordDiagnosisTiming(debugTiming, timingRows, 'effect -> setTimeout', effectStart, handlerStart);

      const suggestionsStart = performance.now();
      const suggestions = generateSuggestions(result);
      recordDiagnosisTiming(debugTiming, timingRows, 'generateSuggestions', suggestionsStart, undefined, { suggestions: suggestions.length });

      const summaryStart = performance.now();
      const nextSummary = buildNetlogDiagnosisSummary(result, suggestions, events);
      recordDiagnosisTiming(debugTiming, timingRows, 'buildNetlogDiagnosisSummary', summaryStart, undefined, { cards: nextSummary.cards.length });

      const legacyStart = performance.now();
      const nextLegacyData = buildLegacyDiagnosisData(result);
      recordDiagnosisTiming(debugTiming, timingRows, 'buildLegacyDiagnosisData', legacyStart, undefined, { legacyIssues: nextLegacyData.groupedIssues.length });

      if (cancelled) return;
      const setStateStart = performance.now();
      setDiagnosisSummary(nextSummary);
      setLegacyData(nextLegacyData);
      setDiagnosisLoading(false);
      recordDiagnosisTiming(debugTiming, timingRows, 'setState dispatch', setStateStart);
      recordDiagnosisTiming(debugTiming, timingRows, 'setTimeout handler total', handlerStart);

      if (debugTiming) {
        console.info('[diagnosis timing json]', JSON.stringify({
          label: 'DiagnosisTab first-build',
          rows: timingRows,
          extra: {
            cards: nextSummary.cards.length,
            legacyIssues: nextLegacyData.groupedIssues.length,
            events: events.length,
            urlRequests: result.urlRequests.length,
            totalEvents: result.totalEvents,
            errors: result.errors.length,
            warnings: result.warnings.length,
            info: result.info.length,
            hash: window.location.hash,
          },
        }));
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [result, events]);

  const finalSummary = useMemo(
    () => diagnosisSummary ? buildFinalDiagnosisSummary(diagnosisSummary, 'netlog') : undefined,
    [diagnosisSummary]
  );
  const dnsIpEvidence = useMemo(() => extractDnsIpEvidenceFromNetlog(result), [result]);
  const showAndScrollExpertDiagnosis = () => {
    setShowExpertDiagnosis(true);
    window.setTimeout(() => {
      expertDiagnosisRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  };

  return (
    <>
      {/* 最终诊断收敛层 */}
      {!diagnosisLoading && finalSummary && (
        <FinalDiagnosisPanel
          finalSummary={finalSummary}
          onShowExpertDetails={showAndScrollExpertDiagnosis}
        />
      )}

      {!diagnosisLoading && (
        <DnsAndIpEvidencePanel summary={dnsIpEvidence} />
      )}

      {/* 完整诊断卡片：专家视图 */}
      {diagnosisLoading ? (
        <DiagnosisPanel loading={diagnosisLoading} />
      ) : diagnosisSummary && (
        <div ref={expertDiagnosisRef}>
          <Collapse
            activeKey={showExpertDiagnosis ? ['expert-diagnosis'] : []}
            onChange={keys => setShowExpertDiagnosis((keys as string[]).includes('expert-diagnosis'))}
            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)', borderRadius: 12, marginBottom: 16 }}
          >
            <Collapse.Panel header={`完整诊断报告（共 ${diagnosisSummary.cards.length} 项）`} key="expert-diagnosis">
              <DiagnosisPanel
                summary={diagnosisSummary}
                initialCardCount={INITIAL_DIAGNOSIS_CARDS}
                cardLoadStep={DIAGNOSIS_CARD_LOAD_STEP}
              />
            </Collapse.Panel>
          </Collapse>
        </div>
      )}

      {/* 定因诊断报告 */}
      {!diagnosisLoading && legacyData && (
        <Card
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><MedicineBoxOutlined /> 定因诊断报告</span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {result.errors.length} 个错误 · {result.warnings.length} 个警告 · {result.info.length} 个信息
              </span>
            </div>
          }
          style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
        >
          {/* Category summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            {Object.entries(legacyData.categories).map(([cat, info]) => {
              const isProxy = cat === '代理';
              const hasWarning = info.warnings > 0;
              const hasError = info.errors > 0;
              const borderColor = hasError ? '#f87171' : hasWarning ? '#fbbf24' : '#4a9eff';
              return (
                <div
                  key={cat}
                  style={{
                    padding: 12,
                    background: 'var(--bg-surface)',
                    borderRadius: 8,
                    borderLeft: `3px solid ${borderColor}`,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{cat}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {hasError && <span style={{ color: '#f87171' }}>{info.errors} 错误 </span>}
                    {hasWarning && <span style={{ color: '#fbbf24' }}>{info.warnings} 警告</span>}
                    {!hasError && !hasWarning && (
                      <span style={{ color: isProxy ? '#fbbf24' : '#34d399' }}>
                        {isProxy ? '已开启' : '正常'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detailed issues */}
          <h4 style={{ fontSize: 15, color: 'var(--text-primary)', marginBottom: 12, fontWeight: 600 }}>详细诊断结果</h4>
          {legacyData.groupedIssues.length === 0 ? (
            <Alert
              message={<span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>网络状态正常</span>}
              description={<span style={{ color: 'var(--text-secondary)' }}>未检测到任何网络问题，所有请求均正常完成。</span>}
              type="success"
              style={{ background: 'var(--bg-surface)', borderColor: '#34d399' }}
            />
          ) : (
            Array.from(legacyData.byCategory.entries()).map(([category, items]) => {
              const clickCount = loadedCategories.get(category) || 0;
              const isAllLoaded = clickCount === 999;
              const visibleCount = isAllLoaded ? items.length : INITIAL_SHOW + clickCount * LOAD_MORE_STEP;
              const visibleItems = items.slice(0, visibleCount);
              const remaining = items.length - visibleCount;
              const showLoadAll = visibleCount >= FULL_THRESHOLD && items.length > visibleCount;
              const hasMore = remaining > 0;

              return (
                <div key={category} style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 10,
                      padding: '6px 0',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                  >
                    <Tag
                      color={items[0]?.severity === 'error' || items[0]?.severity === 'critical' ? 'red' : items[0]?.severity === 'warning' ? 'orange' : 'blue'}
                      style={{ fontWeight: 600, fontSize: 13 }}
                    >
                      {category}
                    </Tag>
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      共 {items.length} 条
                    </span>
                  </div>

                  {visibleItems.map((item, i) => (
                    <IssueAlert
                      key={`${category}-${i}`}
                      item={item}
                      index={i}
                      expandedKeys={expandedKeys}
                      setExpandedKeys={setExpandedKeys}
                    />
                  ))}

                  {hasMore ? (
                    <div style={{ textAlign: 'center', padding: '8px 0' }}>
                      <Button
                        type="link"
                        icon={<DownOutlined />}
                        onClick={() =>
                          setLoadedCategories(prev => {
                            const newMap = new Map(prev);
                            if (showLoadAll || isAllLoaded) {
                              newMap.set(category, 999);
                            } else {
                              newMap.set(category, (prev.get(category) || 0) + 1);
                            }
                            return newMap;
                          })
                        }
                        style={{ color: '#0ea5e9', fontSize: 13 }}
                      >
                        {showLoadAll ? `加载全部 (剩余${remaining}条)` : `加载更多 (剩余${remaining}条)`}
                      </Button>
                    </div>
                  ) : clickCount > 0 ? (
                    <div style={{ textAlign: 'center', padding: '8px 0' }}>
                      <Button
                        type="link"
                        icon={<UpOutlined />}
                        onClick={() =>
                          setLoadedCategories(prev => {
                            const newMap = new Map(prev);
                            newMap.delete(category);
                            return newMap;
                          })
                        }
                        style={{ color: 'var(--text-muted)', fontSize: 13 }}
                      >
                        收起
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </Card>
      )}
    </>
  );
};

export default DiagnosisTab;
