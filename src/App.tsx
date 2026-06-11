import { useState, useEffect } from 'react';
import { Layout, Tabs, Button, message, FloatButton, Alert } from 'antd';
import {
  ReloadOutlined,
  DownloadOutlined,
  DashboardOutlined,
  ClockCircleOutlined,
  SafetyOutlined,
  ApiOutlined,
  MedicineBoxOutlined,
  UnorderedListOutlined,
  RadarChartOutlined,
  SunOutlined,
  MoonOutlined,
  VerticalAlignTopOutlined,
  WarningOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { parseLog, ParsedEvent, AnalysisResult } from './parser';
import { isHarFile, parseHar, HarAnalysisResult } from './harParser';
import { exportReport } from './diagnosis';
import { useTheme } from './theme';
import UploadZone from './components/UploadZone';
import SummaryCards from './components/SummaryCards';
import OverviewTab from './components/OverviewTab';
import PerformanceTab from './components/PerformanceTab';
import SSLTab from './components/SSLTab';
import ProtocolTab from './components/ProtocolTab';
import DiagnosisTab from './components/DiagnosisTab';
import EventsTab from './components/EventsTab';
import HarResultPage from './components/har/HarResultPage';

const { Header, Content } = Layout;

const App: React.FC = () => {
  const [hasData, setHasData] = useState(false);
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [harResult, setHarResult] = useState<HarAnalysisResult | null>(null);
  const [fileType, setFileType] = useState<'netlog' | 'har'>('netlog');
  const [loading, setLoading] = useState(false);
  const [showBackTop, setShowBackTop] = useState(false);
  const { mode, toggleTheme } = useTheme();

  useEffect(() => {
    const handleScroll = () => {
      setShowBackTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleFileLoaded = (data: any) => {
    setLoading(true);
    setTimeout(() => {
      try {
        // 自动识别文件类型：HAR 走独立解析逻辑，NetLog 走原有逻辑
        if (isHarFile(data)) {
          const harAnalysis = parseHar(data);
          setHarResult(harAnalysis);
          setFileType('har');
          setHasData(true);
          setLoading(false);
          message.success(`成功解析 ${harAnalysis.totalRequests} 个 HAR 请求`);
          return;
        }
        const { events: parsedEvents, result: analysisResult } = parseLog(data);
        setEvents(parsedEvents);
        setResult(analysisResult);
        setFileType('netlog');
        setHasData(true);
        setLoading(false);
        message.success(`成功解析 ${parsedEvents.length} 个事件`);
      } catch (err) {
        setLoading(false);
        message.error('解析失败: ' + (err as Error).message);
      }
    }, 100);
  };

  const handleReset = () => {
    setHasData(false);
    setEvents([]);
    setResult(null);
    setHarResult(null);
    setFileType('netlog');
  };

  const handleExport = () => {
    if (!result) return;
    const report = exportReport(result);
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `netlog-analysis-report-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('报告已导出');
  };

  const tabItems = [
    { key: 'overview', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><DashboardOutlined />总览</span>, children: result ? <OverviewTab result={result} /> : null },
    { key: 'diagnosis', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MedicineBoxOutlined />定因诊断</span>, children: result ? <DiagnosisTab result={result} /> : null },
    { key: 'events', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><UnorderedListOutlined />事件列表</span>, children: <EventsTab events={events} /> },
    { key: 'ssl', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><SafetyOutlined />SSL/TLS</span>, children: result ? <SSLTab result={result} /> : null },
    { key: 'protocol', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ApiOutlined />协议分析</span>, children: result ? <ProtocolTab result={result} /> : null },
    { key: 'performance', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ClockCircleOutlined />性能分析</span>, children: result ? <PerformanceTab result={result} /> : null },
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* ====== Modern Header ====== */}
      <Header
        style={{
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 40px',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          height: 68,
          lineHeight: 'normal',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          {/* Logo icon - Network/Radar themed */}
          <div
            style={{
              width: 38,
              height: 38,
              background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(14, 165, 233, 0.25)',
            }}
          >
            <RadarChartOutlined style={{ color: '#fff', fontSize: 20 }} />
          </div>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
                letterSpacing: 0.3,
                lineHeight: 1.3,
              }}
            >
              NetLog 网络日志定因分析工具
            </h1>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
              Chrome / Edge 网络日志 (NetLog) 与 HAR 可视化分析平台
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexShrink: 0, alignItems: 'center' }}>
          {/* Theme Toggle Button */}
          <Button
            icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggleTheme}
            size="large"
            style={{
              background: mode === 'dark'
                ? 'linear-gradient(135deg, #f59e0b, #fbbf24)'
                : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              border: 'none',
              color: '#fff',
              fontWeight: 600,
              fontSize: 15,
              height: 40,
              padding: '0 18px',
              borderRadius: 10,
              boxShadow: mode === 'dark'
                ? '0 2px 12px rgba(245, 158, 11, 0.35)'
                : '0 2px 12px rgba(99, 102, 241, 0.35)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            title={mode === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          >
            {mode === 'dark' ? '浅色' : '深色'}
          </Button>

          {hasData && (
            <>
              <Button
                icon={<ReloadOutlined />}
                onClick={handleReset}
                style={{
                  background: 'var(--bg-elevated)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-secondary)',
                }}
              >
                重新上传
              </Button>
              {fileType === 'netlog' && (
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={handleExport}
                  style={{
                    background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                    border: 'none',
                    fontWeight: 600,
                    boxShadow: '0 2px 8px rgba(14, 165, 233, 0.25)',
                  }}
                >
                  导出报告
                </Button>
              )}
            </>
          )}
        </div>
      </Header>

      {/* ====== Main Content ====== */}
      <Content style={{ maxWidth: 1440, margin: '0 auto', padding: '28px 32px', width: '100%' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 20 }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.15), rgba(99, 102, 241, 0.15))',
                border: '2px solid rgba(14, 165, 233, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            >
              <LoadingOutlined style={{ fontSize: 32, color: '#0ea5e9' }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                正在分析日志数据...
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                请稍候，正在提取事件、统计指标和诊断信息
              </div>
            </div>
          </div>
        ) : !hasData ? (
          <div style={{ maxWidth: 900, margin: '48px auto' }}>
            <UploadZone onFileLoaded={handleFileLoaded} />
          </div>
        ) : fileType === 'har' && harResult ? (
          <HarResultPage result={harResult} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {result && <SummaryCards result={result} />}
            <Alert
              message={
                <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                  <WarningOutlined style={{ marginRight: 6, color: '#fbbf24' }} />
                  郑重说明
                </span>
              }
              description={
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  本工具解析内容仅供参考，具体原因需人工二次确认或自行尝试「定因诊断」中的建议操作。分析结果可能因日志版本、浏览器差异等因素存在偏差，请结合实际情况综合判断。
                </span>
              }
              type="warning"
              showIcon={false}
              style={{
                background: 'rgba(251, 191, 36, 0.06)',
                border: '1px solid rgba(251, 191, 36, 0.2)',
                borderRadius: 10,
              }}
            />
            <div
              style={{
                background: 'var(--bg-surface)',
                borderRadius: 14,
                border: '1px solid var(--border-color)',
                overflow: 'hidden',
                boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
              }}
            >
              <Tabs
                items={tabItems}
                type="card"
                style={{
                  background: 'var(--bg-surface)',
                }}
              />
            </div>
          </div>
        )}
      </Content>

      {/* Back to Top Button */}
      {showBackTop && (
        <FloatButton
          icon={<VerticalAlignTopOutlined />}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          style={{
            position: 'fixed',
            right: 32,
            bottom: 32,
            zIndex: 999,
          }}
          tooltip="回到顶部"
        />
      )}
    </Layout>
  );
};

export default App;
