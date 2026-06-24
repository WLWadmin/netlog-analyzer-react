import { useState, useMemo } from 'react';
import { Card, Alert, Tag, Button } from 'antd';
import { DownOutlined, UpOutlined, MedicineBoxOutlined } from '@ant-design/icons';
import { AnalysisResult } from '../../parsers/netlog/parser';
import { generateSuggestions } from '../../parsers/netlog/diagnosis';
import { groupIssues, groupByCategory, IssueAlert } from '../../components/shared/IssueDisplay';
import { buildNetlogDiagnosisSummary } from '../../diagnosis/shared';
import DiagnosisPanel from '../shared/DiagnosisPanel';

interface DiagnosisTabProps {
  result: AnalysisResult;
}

const DiagnosisTab: React.FC<DiagnosisTabProps> = ({ result }) => {
  const groupedIssues = useMemo(() => groupIssues(result.errors, [...result.warnings, ...result.info] as any), [result]);
  const byCategory = useMemo(() => groupByCategory(groupedIssues), [groupedIssues]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [loadedCategories, setLoadedCategories] = useState<Map<string, number>>(new Map());
  const suggestions = generateSuggestions(result);

  // 统一诊断模型
  const diagnosisSummary = useMemo(() => buildNetlogDiagnosisSummary(result, suggestions), [result, suggestions]);

  const INITIAL_SHOW = 10;
  const LOAD_MORE_STEP = 100;
  const FULL_THRESHOLD = 300;

  // Category summary (use grouped counts)
  const categories: Record<string, { errors: number; warnings: number; info: number }> = {};
  for (const issue of groupedIssues) {
    const cat = issue.category || '未知';
    if (!categories[cat]) categories[cat] = { errors: 0, warnings: 0, info: 0 };
    if (issue.severity === 'error' || issue.severity === 'critical') categories[cat].errors += issue.count;
    else if (issue.severity === 'warning') categories[cat].warnings += issue.count;
    else categories[cat].info += issue.count;
  }

  return (
    <>
      {/* 统一诊断卡片 */}
      <DiagnosisPanel summary={diagnosisSummary} />

      {/* 定因诊断报告 */}
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
          {Object.entries(categories).map(([cat, info]) => {
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
        {groupedIssues.length === 0 ? (
          <Alert
            message={<span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>网络状态正常</span>}
            description={<span style={{ color: 'var(--text-secondary)' }}>未检测到任何网络问题，所有请求均正常完成。</span>}
            type="success"
            style={{ background: 'var(--bg-surface)', borderColor: '#34d399' }}
          />
        ) : (
          Array.from(byCategory.entries()).map(([category, items]) => {
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
    </>
  );
};

export default DiagnosisTab;
