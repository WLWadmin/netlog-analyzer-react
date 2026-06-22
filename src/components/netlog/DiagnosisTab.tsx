import { useState, useMemo, Fragment } from 'react';
import { Card, Alert, Tag, Collapse, Button } from 'antd';
import { DownOutlined, UpOutlined, UnorderedListOutlined, BulbOutlined, PushpinOutlined, ToolOutlined, MedicineBoxOutlined, WarningOutlined, CloseCircleOutlined, SearchOutlined, SyncOutlined, GlobalOutlined, LockOutlined, LinkOutlined, QuestionCircleOutlined, StopOutlined, AppstoreOutlined, InboxOutlined } from '@ant-design/icons';
import { AnalysisResult } from '../../parsers/netlog/parser';
import { generateSuggestions, generateNextStepInfo, Suggestion } from '../../parsers/netlog/diagnosis';
import { groupIssues, groupByCategory, IssueAlert } from '../../components/shared/IssueDisplay';
import { useNavigation, NavigationFilters } from '../../contexts/NavigationContext';

const { Panel } = Collapse;

interface DiagnosisTabProps {
  result: AnalysisResult;
}

const iconMap: Record<string, React.ReactNode> = {
  '💡': <BulbOutlined />,
  '🔧': <ToolOutlined />,
  '⚠️': <WarningOutlined />,
  '❌': <CloseCircleOutlined />,
  '🚨': <CloseCircleOutlined />,
  '🔍': <SearchOutlined />,
  '🔄': <SyncOutlined />,
  '🌐': <GlobalOutlined />,
  '🔒': <LockOutlined />,
  '🔗': <LinkOutlined />,
  '❓': <QuestionCircleOutlined />,
  '🚫': <StopOutlined />,
  '⚙️': <AppstoreOutlined />,
  '📦': <InboxOutlined />,
  '📡': <GlobalOutlined />,
  '🦈': <SearchOutlined />,
};

// 从诊断标题中提取 Chrome NetLog 错误码
const extractNetErrorCode = (title: string): string | undefined => {
  const patterns = [
    // ERR_NAME_NOT_RESOLVED (-105)
    /\((-?\d{1,4})\)/,
    // 错误码: -105 / errorCode: -105 / net_error: -105
    /(?:错误码|errorCode|net_error)\s*[:：]?\s*(-\d{1,4})/i,
    // 涉及错误码: -105
    /涉及错误码\s*[:：]?\s*(-\d{1,4})/,
    // 兜底：只抓负数，避免 HTTP/2、TLS 1.3、P90 被误识别
    /(-\d{1,4})/,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match?.[1]) return match[1];
  }

  return undefined;
};

// 根据诊断建议类型构造精确筛选条件
const buildNavigationFilters = (s: Suggestion): NavigationFilters => {
  const errorCode = extractNetErrorCode(s.title);

  const withErrorCode = (filters: NavigationFilters): NavigationFilters => ({
    ...filters,
    ...(errorCode ? { errorCode } : {}),
  });

  if (s.title.includes('DNS 劫持')) {
    return withErrorCode({ keyword: 'DNS', errorOnly: true });
  }
  if (s.icon === '🌐' || s.title.includes('DNS')) {
    return withErrorCode({ keyword: 'DNS', errorOnly: true });
  }
  if (s.icon === '🔒' || s.title.includes('证书') || s.title.includes('SSL')) {
    return withErrorCode({ keyword: 'SSL', errorOnly: true });
  }
  if (s.icon === '🔗' || s.title.includes('连接')) {
    return withErrorCode({ errorOnly: true });
  }
  if (s.icon === '⚠️' || s.icon === '🚨' || s.title.includes('代理') || s.title.includes('VPN')) {
    return { keyword: 'PROXY' };
  }
  if (s.icon === '📡' || s.title.includes('QUIC') || s.title.includes('HTTP/2')) {
    return withErrorCode({
      keyword: s.title.includes('QUIC') ? 'QUIC' : 'HTTP_STREAM',
    });
  }
  if (s.icon === '🦈' || s.title.includes('慢请求')) {
    return {};
  }
  if (s.icon === '❌' || s.title.includes('域名')) {
    return withErrorCode({ errorOnly: true });
  }
  if (errorCode) {
    return { errorCode, errorOnly: true };
  }
  return { keyword: s.title };
};

// Next step info collection panel (uses generateNextStepInfo from diagnosis.ts)
const NextStepPanel: React.FC<{ result: AnalysisResult }> = ({ result }) => {
  const nextSteps = useMemo(() => generateNextStepInfo(result), [result]);
  const [expanded, setExpanded] = useState<string[]>(nextSteps.length > 0 ? [nextSteps[0].category] : []);

  if (nextSteps.length === 0) {
    return (
      <Card
        title={<span><UnorderedListOutlined /> 下一步定因所需信息</span>}
        style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
      >
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          当前日志未检测到需要进一步排查的问题。如果问题仍然存在，建议收集基础网络信息（出口 IP、ping 测试结果等）进行人工分析。
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={<span><UnorderedListOutlined /> 下一步定因所需信息</span>}
      style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}
    >
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
        根据当前日志分析结果，已智能匹配以下排查方向。请按优先级收集信息，以便进一步定位问题根因。
      </div>

      <Collapse
        ghost
        bordered={false}
        activeKey={expanded}
        onChange={(keys) => setExpanded(keys as string[])}
      >
        {nextSteps.map((section) => (
          <Panel
            key={section.category}
            header={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{section.category}</span>
                <Tag style={{ fontSize: 11 }}>{section.items.length} 项</Tag>
              </div>
            }
            style={{ borderBottom: '1px solid var(--border-color)' }}
          >
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
              {section.description}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {section.items.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '12px 14px',
                    background: 'var(--bg-surface)',
                    borderRadius: 8,
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: 'rgba(74, 158, 255, 0.15)',
                        color: '#4a9eff',
                        fontSize: 12,
                        fontWeight: 700,
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    >
                      {idx + 1}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item}</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </Collapse>
    </Card>
  );
};

const DiagnosisTab: React.FC<DiagnosisTabProps> = ({ result }) => {
  const groupedIssues = useMemo(() => groupIssues(result.errors, [...result.warnings, ...result.info] as any), [result]);
  const byCategory = useMemo(() => groupByCategory(groupedIssues), [groupedIssues]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [loadedCategories, setLoadedCategories] = useState<Map<string, number>>(new Map());
  const suggestions = generateSuggestions(result);
  const { navigateTo } = useNavigation();

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
      {/* Root Cause Suggestions — MOVED TO TOP */}
      <Card title={<span><BulbOutlined /> 根因建议</span>} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
        {suggestions.length === 0 ? (
          <Alert
            message={<span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>无需特殊处理</span>}
            description={<span style={{ color: 'var(--text-secondary)' }}>当前日志未检测到需要特别关注的问题。</span>}
            type="success"
            style={{ background: 'var(--bg-surface)', borderColor: '#34d399' }}
          />
        ) : (
          <Fragment>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, fontStyle: 'italic' }}>
              以下建议已按错误类别合并同类项，去重后展示
            </div>
            {suggestions.map((s, i) => (
              <Alert
                key={i}
                message={
                  <strong style={{ color: 'var(--text-primary)', fontSize: 14 }}>
                    {iconMap[s.icon] || null} {s.title}
                  </strong>
                }
                description={
                  <div style={{ marginTop: 10 }}>
                    {/* Problem description */}
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>
                      {s.detail}
                    </div>
                    {/* Conclusion */}
                    <div style={{ padding: '10px 14px', background: 'rgba(251, 191, 36, 0.06)', borderRadius: 8, border: '1px solid rgba(251, 191, 36, 0.2)', marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#fbbf24', marginBottom: 4 }}>
                        <PushpinOutlined /> 处理结论
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        {s.conclusion}
                      </div>
                    </div>
                    {/* Evidence Navigation */}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <Button
                        size="small"
                        icon={<SearchOutlined />}
                        onClick={() => navigateTo({ tab: 'events', filters: buildNavigationFilters(s), source: '诊断建议', reason: '查看相关事件证据' })}
                      >
                        查看事件证据
                      </Button>
                      <Button
                        size="small"
                        icon={<GlobalOutlined />}
                        onClick={() => navigateTo({ tab: 'requests', filters: buildNavigationFilters(s), source: '诊断建议', reason: '查看相关请求瀑布' })}
                      >
                        查看请求瀑布
                      </Button>
                    </div>
                    {/* Action steps */}
                    {s.actions && s.actions.length > 0 && (
                      <div style={{ padding: '10px 14px', background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                          <ToolOutlined /> 自主解决步骤：
                        </div>
                        {s.actions.map((action, j) => (
                          <div
                            key={j}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 8,
                              marginBottom: j < s.actions!.length - 1 ? 8 : 0,
                              fontSize: 13,
                            }}
                          >
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 20,
                                height: 20,
                                borderRadius: '50%',
                                background: 'rgba(74, 158, 255, 0.15)',
                                color: '#4a9eff',
                                fontSize: 11,
                                fontWeight: 700,
                                flexShrink: 0,
                                marginTop: 1,
                              }}
                            >
                              {j + 1}
                            </span>
                            <span style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{action}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                }
                type={i === 0 && result.errors.length > 0 ? 'error' : 'info'}
                style={{ marginBottom: 12, background: 'var(--bg-surface)', border: `1px solid ${i === 0 && result.errors.length > 0 ? 'rgba(248, 113, 113, 0.2)' : 'rgba(91, 163, 245, 0.2)'}` }}
              />
            ))}
          </Fragment>
        )}
      </Card>

      {/* Next Step Info Collection */}
      <NextStepPanel result={result} />

      {/* Diagnosis Report */}
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
