import React from 'react';
import {
  CodeOutlined,
  FileSearchOutlined,
  GlobalOutlined,
  MedicineBoxOutlined,
  RadarChartOutlined,
} from '@ant-design/icons';
import './netlogNavigation.css';

export interface NetlogWorkbenchNavItem {
  key: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}

interface NetlogWorkbenchNavProps {
  activeKey: string;
  onChange: (key: string) => void;
}

export const NETLOG_WORKBENCH_NAV_ITEMS: NetlogWorkbenchNavItem[] = [
  {
    key: 'conclusion',
    label: '结论与行动',
    description: '先看结论、行动清单和缺失信息',
    icon: <MedicineBoxOutlined />,
  },
  {
    key: 'requests',
    label: '请求详情',
    description: '定位失败、慢请求、错误码和 URL',
    icon: <GlobalOutlined />,
  },
  {
    key: 'evidence',
    label: '证据链',
    description: '核对 DNS、代理、CIP/SIP 和联合证据',
    icon: <RadarChartOutlined />,
  },
  {
    key: 'expert',
    label: '专家分析',
    description: '事件、源链路、协议、性能和报告',
    icon: <CodeOutlined />,
  },
  {
    key: 'raw',
    label: '原始数据',
    description: '回到 NetLog JSON 和结构化证据',
    icon: <FileSearchOutlined />,
  },
];

const NetlogWorkbenchNav: React.FC<NetlogWorkbenchNavProps> = ({ activeKey, onChange }) => (
  <nav className="netlog-workbench-nav" aria-label="NetLog 诊断工作台导航">
    <div className="netlog-workbench-nav__header">
      <div>
        <div className="netlog-workbench-nav__eyebrow">NetLog Workbench</div>
        <div className="netlog-workbench-nav__title">诊断工作台</div>
      </div>
      <div className="netlog-workbench-nav__hint">
        一级导航表示排查主流程；专家细节会在「专家分析」内部继续分层。
      </div>
    </div>

    <div className="netlog-workbench-nav__items">
      {NETLOG_WORKBENCH_NAV_ITEMS.map(item => {
        const active = activeKey === item.key;
        return (
          <button
            key={item.key}
            type="button"
            className={`netlog-workbench-nav__item${active ? ' netlog-workbench-nav__item--active' : ''}`}
            onClick={() => onChange(item.key)}
            aria-pressed={active}
          >
            <span className="netlog-workbench-nav__item-top">
              <span className="netlog-workbench-nav__icon">{item.icon}</span>
              <span className="netlog-workbench-nav__label">{item.label}</span>
            </span>
            <span className="netlog-workbench-nav__desc">{item.description}</span>
          </button>
        );
      })}
    </div>
  </nav>
);

export default NetlogWorkbenchNav;
