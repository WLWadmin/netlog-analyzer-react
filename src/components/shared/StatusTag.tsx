import React from 'react';
import { Tag } from 'antd';
import { TAG_CONFIG, getStatusTagType, StatusType } from '../../constants/tagConfig';

interface Props { status?: StatusType; statusCode?: number; children: React.ReactNode; }

export const StatusTag: React.FC<Props> = ({ status, statusCode, children }) => {
  const type = status || (statusCode !== undefined ? getStatusTagType(statusCode) : 'default');
  const cfg = TAG_CONFIG[type as StatusType] || TAG_CONFIG.default;
  return <Tag color={cfg.color} style={cfg.style}>{children}</Tag>;
};
