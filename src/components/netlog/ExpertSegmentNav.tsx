import React from 'react';
import {
  ApartmentOutlined,
  BarChartOutlined,
  CodeOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FileTextOutlined,
  PartitionOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import './netlogNavigation.css';

export interface ExpertSegmentItem {
  key: string;
  label: string;
  icon: React.ReactNode;
}

interface ExpertSegmentNavProps {
  activeKey: string;
  onChange: (key: string) => void;
}

export const EXPERT_SEGMENT_ITEMS: ExpertSegmentItem[] = [
  { key: 'data-loaded', label: 'Data Loaded', icon: <DatabaseOutlined /> },
  { key: 'events', label: '事件列表', icon: <CodeOutlined /> },
  { key: 'source-chain', label: '源链路', icon: <ApartmentOutlined /> },
  { key: 'security', label: '安全与协议', icon: <SafetyOutlined /> },
  { key: 'network-state', label: '网络状态', icon: <DeploymentUnitOutlined /> },
  { key: 'performance', label: '性能分析', icon: <BarChartOutlined /> },
  { key: 'baseline', label: 'A-B 对比', icon: <PartitionOutlined /> },
  { key: 'report', label: '完整诊断报告', icon: <FileTextOutlined /> },
];

const ExpertSegmentNav: React.FC<ExpertSegmentNavProps> = ({ activeKey, onChange }) => (
  <section className="expert-segment-shell" aria-label="专家分析二级导航">
    <div className="expert-segment-shell__head">
      <div>
        <div className="expert-segment-shell__title">专家分析</div>
        <div className="expert-segment-shell__desc">
          面向深度排障：回到事件、source、协议、性能和完整诊断报告。
        </div>
      </div>
    </div>
    <div className="expert-segment" role="tablist">
      {EXPERT_SEGMENT_ITEMS.map(item => {
        const active = activeKey === item.key;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={`expert-segment__item${active ? ' expert-segment__item--active' : ''}`}
            onClick={() => onChange(item.key)}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  </section>
);

export default ExpertSegmentNav;
