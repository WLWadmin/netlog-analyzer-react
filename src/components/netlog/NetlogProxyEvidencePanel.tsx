import React from 'react';
import { Alert, Card, Descriptions } from 'antd';
import type { AnalysisResult } from '../../parsers/netlog/parser';

const NetlogProxyEvidencePanel: React.FC<{ result: AnalysisResult }> = ({ result }) => {
  const pi = result.proxyInfo;
  const hasProxyEvidence = pi.hasProxy || pi.isVPN || result.proxyEvents.length > 0;

  if (!hasProxyEvidence) {
    return (
      <Alert
        type="info"
        showIcon
        message="未识别到明显代理 / VPN 证据"
        description="如果用户实际使用企业代理或 VPN，但文件中没有代理配置，请补充系统代理配置截图或重新抓取 NetLog。"
      />
    );
  }

  return (
    <Card title="代理 / VPN 证据" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
      <Descriptions size="small" column={1}>
        <Descriptions.Item label="代理状态">{pi.hasProxy || pi.isVPN ? '检测到' : '仅有代理相关事件'}</Descriptions.Item>
        <Descriptions.Item label="代理模式">{pi.proxyType || '未识别'}</Descriptions.Item>
        <Descriptions.Item label="代理地址">{pi.proxyList.join(', ') || '-'}</Descriptions.Item>
        <Descriptions.Item label="PAC 地址">{pi.pacUrl || '-'}</Descriptions.Item>
        <Descriptions.Item label="VPN 线索">{pi.vpnHints.join('、') || '-'}</Descriptions.Item>
        <Descriptions.Item label="代理事件">{result.proxyEvents.length} 条</Descriptions.Item>
      </Descriptions>
      <Alert
        type="warning"
        showIcon
        message="建议做代理/直连对比"
        description="在公司安全策略允许前提下，临时关闭代理/VPN 或切换直连网络复现。如果问题消失，代理链路高度可疑。"
        style={{ marginTop: 12 }}
      />
    </Card>
  );
};

export default NetlogProxyEvidencePanel;
