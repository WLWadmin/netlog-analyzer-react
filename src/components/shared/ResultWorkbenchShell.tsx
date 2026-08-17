import { useState } from 'react';
import type { ReactNode } from 'react';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import type { FileType } from '../../utils/hashRouting';
import './resultWorkbenchShell.css';

export interface ResultWorkbenchNavItem {
  key: string;
  label: string;
  icon: ReactNode;
  group: string;
  count?: ReactNode;
}

interface ResultWorkbenchShellProps {
  parser: FileType;
  parserLabel: string;
  statusLabel: string;
  activeKey: string;
  items: ResultWorkbenchNavItem[];
  onChange: (key: string) => void;
  children: ReactNode;
}

const STORAGE_PREFIX = 'netlog-workbench-sidebar-collapsed-v1';

function storageKey(parser: FileType): string {
  return `${STORAGE_PREFIX}-${parser}`;
}

function readCollapsed(parser: FileType): boolean {
  try {
    return window.localStorage.getItem(storageKey(parser)) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(parser: FileType, collapsed: boolean): void {
  try {
    window.localStorage.setItem(storageKey(parser), collapsed ? '1' : '0');
  } catch {
    // Storage can be unavailable in restricted browser contexts; expanded remains the default.
  }
}

const ResultWorkbenchShell: React.FC<ResultWorkbenchShellProps> = ({
  parser,
  parserLabel,
  statusLabel,
  activeKey,
  items,
  onChange,
  children,
}) => {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(parser));
  const activeItem = items.find(item => item.key === activeKey) ?? items[0];
  const groups = Array.from(new Set(items.map(item => item.group)));
  const sidebarId = `result-workbench-sidebar-${parser}`;

  const toggleCollapsed = () => {
    setCollapsed(previous => {
      const next = !previous;
      writeCollapsed(parser, next);
      return next;
    });
  };

  return (
    <section className={`result-workbench-shell${collapsed ? ' is-collapsed' : ''}`} data-parser={parser}>
      <aside className="result-workbench-sidebar" id={sidebarId} aria-label={`${parserLabel} 分析导航`}>
        <button
          type="button"
          className="result-workbench-toggle"
          aria-controls={sidebarId}
          aria-expanded={!collapsed}
          aria-label={collapsed ? '展开分析导航' : '收起分析导航'}
          title={collapsed ? '展开分析导航' : '收起分析导航'}
          onClick={toggleCollapsed}
        >
          {collapsed ? <RightOutlined /> : <LeftOutlined />}
        </button>

        <div className="result-workbench-identity">
          <span className="result-workbench-identity__mark" aria-hidden="true">
            {parserLabel.slice(0, 1)}
          </span>
          <span className="result-workbench-identity__copy">
            <strong>{parserLabel}</strong>
            <small>{statusLabel}</small>
          </span>
        </div>

        {groups.map(group => (
          <div className="result-workbench-nav-group" key={group}>
            <div className="result-workbench-nav-label">{group}</div>
            <nav aria-label={group}>
              {items.filter(item => item.group === group).map(item => {
                const active = item.key === activeKey;
                return (
                  <button
                    type="button"
                    key={item.key}
                    className={active ? 'is-active' : undefined}
                    aria-current={active ? 'page' : undefined}
                    aria-label={item.label}
                    title={collapsed ? item.label : undefined}
                    onClick={() => onChange(item.key)}
                  >
                    <span className="result-workbench-nav-icon" aria-hidden="true">{item.icon}</span>
                    <span className="result-workbench-nav-text">{item.label}</span>
                    {item.count !== undefined ? (
                      <span className="result-workbench-nav-count">{item.count}</span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
          </div>
        ))}
      </aside>

      <div className="result-workbench-main">
        <div className="result-workbench-breadcrumb">
          <span>{parserLabel}</span>
          <span aria-hidden="true">/</span>
          <strong>{activeItem?.label}</strong>
        </div>
        {children}
      </div>
    </section>
  );
};

export default ResultWorkbenchShell;
