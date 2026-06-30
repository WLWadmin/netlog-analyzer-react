import { useState, useMemo } from 'react';
import { Alert, Tag, Badge, Collapse, Button } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';

const { Panel } = Collapse;

// ============================================================
// 类型定义
// ============================================================

/** 合并后的 severity 类型，兼容 error/warning/info/ok/critical 及其他字符串 */
export type IssueSeverity = 'error' | 'warning' | 'info' | 'ok' | 'critical' | string;

/** 分组后的单条 issue 数据结构 */
export interface GroupedIssue {
  category: string;
  message: string;
  severity: IssueSeverity;
  count: number;
  items: IssueItem[];
}

/** 原始 issue 数据结构（来自 errors / warnings / info） */
export interface IssueItem {
  category: string;
  message: string;
  severity: string;
  detail: string;
  time: number;
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 将 errors 和 warnings 合并并按 category+message 分组
 * 慢请求类别（category === '慢请求'）每条单独展示，不合并
 * 排序优先级：error/critical > warning > info > ok，同 severity 按数量降序
 */
export function groupIssues(
  errors: IssueItem[],
  warnings: IssueItem[]
): GroupedIssue[] {
  const all: IssueItem[] = [
    ...errors.map(e => ({ ...e, severity: 'error' as const })),
    ...warnings.map(w => ({ ...w, severity: 'warning' as const })),
  ];

  const grouped = new Map<string, GroupedIssue>();

  for (const item of all) {
    // 慢请求：每条单独展示（按完整 message 区分）
    const isSlowRequest = item.category === '慢请求';
    const key = isSlowRequest ? `slow-${item.message}` : `${item.category}|${item.message}`;

    if (grouped.has(key)) {
      const g = grouped.get(key)!;
      g.count++;
      g.items.push(item);
    } else {
      grouped.set(key, {
        category: item.category,
        message: item.message,
        severity: item.severity,
        count: 1,
        items: [item],
      });
    }
  }

  return Array.from(grouped.values()).sort((a, b) => {
    // 排序优先级：error/critical(0) > warning(1) > info(2) > ok(3)
    const order: Record<string, number> = { error: 0, critical: 0, warning: 1, info: 2, ok: 3 };
    const orderA = order[a.severity] ?? 3;
    const orderB = order[b.severity] ?? 3;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return b.count - a.count;
  });
}

/**
 * 将分组后的 issues 按 category 再次归类，用于分类展示和加载更多逻辑
 */
export function groupByCategory(
  issues: GroupedIssue[]
): Map<string, GroupedIssue[]> {
  const map = new Map<string, GroupedIssue[]>();
  for (const item of issues) {
    const cat = item.category;
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(item);
  }
  return map;
}

/**
 * 根据 severity 获取对应的颜色名称
 * - error / critical -> red
 * - warning -> orange
 * - ok -> green
 * - info / 其他 -> blue
 */
function getSeverityColor(severity: IssueSeverity): string {
  if (severity === 'error' || severity === 'critical') return 'red';
  if (severity === 'warning') return 'orange';
  if (severity === 'ok') return 'green';
  return 'blue';
}

/**
 * 根据 severity 获取对应的边框颜色（rgba 格式）
 */
function getSeverityBorderColor(severity: IssueSeverity): string {
  const color = getSeverityColor(severity);
  const colorMap: Record<string, string> = {
    red: 'rgba(248, 113, 113, 0.2)',
    orange: 'rgba(251, 191, 36, 0.2)',
    green: 'rgba(52, 211, 153, 0.2)',
    blue: 'rgba(91, 163, 245, 0.2)',
  };
  return colorMap[color] || colorMap.blue;
}

// ============================================================
// IssueAlert 组件
// ============================================================

export interface IssueAlertProps {
  /** 分组后的 issue 数据 */
  item: GroupedIssue;
  /** 当前 issue 在列表中的索引，用于生成唯一 key */
  index: number;
  /** 当前展开的详情面板 key 列表 */
  expandedKeys: string[];
  /** 设置展开面板 key 列表的回调 */
  setExpandedKeys: (keys: string[]) => void;
}

/**
 * 单条 Issue 提示组件
 * - 根据 severity 显示不同颜色（red/orange/green/blue）
 * - 慢请求直接展示详情
 * - 多条同类 issue 支持折叠展开查看详情
 */
export const IssueAlert: React.FC<IssueAlertProps> = ({
  item,
  index,
  expandedKeys,
  setExpandedKeys,
}) => {
  const isSlowRequest = item.category === '慢请求';
  const hasMultiple = item.count > 1 && !isSlowRequest;
  const color = getSeverityColor(item.severity);
  const borderColor = getSeverityBorderColor(item.severity);

  return (
    <Alert
      key={`issue-${index}`}
      message={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Badge color={color} />
          <Tag color={color} style={{ fontWeight: 600 }}>{item.category}</Tag>
          <span
            style={{
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: 14,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
            title={item.message}
          >
            {item.message}
          </span>
          {hasMultiple && (
            <Tag color={color} style={{ marginLeft: 'auto', flexShrink: 0 }}>
              × {item.count}
            </Tag>
          )}
        </div>
      }
      description={
        <div style={{ marginTop: 10 }}>
          {isSlowRequest ? (
            /* 慢请求：直接展示详情 */
            <pre
              style={{
                margin: 0,
                fontSize: 13,
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                lineHeight: 1.6,
              }}
            >
              {item.items[0].detail}
            </pre>
          ) : hasMultiple ? (
            /* 多条同类 issue：折叠展开 */
            <Collapse
              ghost
              bordered={false}
              activeKey={expandedKeys}
              onChange={(keys) => setExpandedKeys(keys as string[])}
              style={{ background: 'transparent' }}
            >
              <Panel
                header={
                  <span style={{ color: '#9ca3af', fontSize: 13 }}>
                    点击查看 {item.count} 条详情
                  </span>
                }
                key={`panel-${index}`}
                style={{ padding: 0 }}
              >
                {item.items.map((sub, idx) => (
                  <pre
                    key={idx}
                    style={{
                      margin: '4px 0',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                      lineHeight: 1.5,
                      padding: '8px 12px',
                      background: 'var(--bg-base)',
                      borderRadius: 6,
                    }}
                  >
                    {sub.detail}
                  </pre>
                ))}
              </Panel>
            </Collapse>
          ) : (
            /* 单条 issue：直接展示详情 */
            <pre
              style={{
                margin: 0,
                fontSize: 13,
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                lineHeight: 1.6,
              }}
            >
              {item.items[0].detail}
            </pre>
          )}
        </div>
      }
      type={color as any}
      style={{
        marginBottom: 10,
        background: 'var(--bg-surface)',
        border: `1px solid ${borderColor}`,
      }}
    />
  );
};

// ============================================================
// IssueSummaryList 组件
// ============================================================

export interface IssueSummaryListProps {
  /** 错误列表 */
  errors: IssueItem[];
  /** 警告列表 */
  warnings: IssueItem[];
}

/**
 * Issue 摘要列表组件
 * - 按 category 分组展示
 * - 每个分类有标题和计数
 * - 支持加载更多 / 收起功能
 * - 初始显示 10 条，每次加载 100 条，超过 300 条显示"加载全部"按钮
 */
export const IssueSummaryList: React.FC<IssueSummaryListProps> = ({
  errors,
  warnings,
}) => {
  const grouped = useMemo(() => groupIssues(errors, warnings), [errors, warnings]);
  const byCategory = useMemo(() => groupByCategory(grouped), [grouped]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [loadedCategories, setLoadedCategories] = useState<Map<string, number>>(new Map());

  const INITIAL_SHOW = 10;
  const LOAD_MORE_STEP = 100;
  const FULL_THRESHOLD = 300;

  return (
    <>
      {Array.from(byCategory.entries()).map(([category, items]) => {
        const clickCount = loadedCategories.get(category) || 0;
        // 特殊标记 999 表示"已加载全部"
        const isAllLoaded = clickCount === 999;
        const visibleCount = isAllLoaded ? items.length : INITIAL_SHOW + clickCount * LOAD_MORE_STEP;
        const visibleItems = items.slice(0, visibleCount);
        const remaining = items.length - visibleCount;
        const showLoadAll = visibleCount >= FULL_THRESHOLD && items.length > visibleCount;
        const hasMore = remaining > 0;

        return (
          <div key={category} style={{ marginBottom: 16 }}>
            {/* 分类标题 */}
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
                color={getSeverityColor(items[0]?.severity)}
                style={{ fontWeight: 600, fontSize: 13 }}
              >
                {category}
              </Tag>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                共 {items.length} 条
              </span>
            </div>

            {/* Issue 列表 */}
            {visibleItems.map((item, i) => (
              <IssueAlert
                key={`${category}-${i}`}
                item={item}
                index={i}
                expandedKeys={expandedKeys}
                setExpandedKeys={setExpandedKeys}
              />
            ))}

            {/* 加载更多 / 收起按钮 */}
            {hasMore ? (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <Button
                  type="link"
                  icon={<DownOutlined />}
                  onClick={() =>
                    setLoadedCategories(prev => {
                      const newMap = new Map(prev);
                      if (showLoadAll || isAllLoaded) {
                        // 加载全部：设置标记为 999
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
      })}
      {(errors.length > 0 || warnings.length > 0) && grouped.length < errors.length + warnings.length && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>
          已合并重复项，更多详情请查看 NetLog「专家分析」中的完整诊断报告
        </div>
      )}
    </>
  );
};
