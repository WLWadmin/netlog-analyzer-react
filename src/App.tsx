import { useState, useEffect } from 'react';
import { Layout, Tabs, Button, message, FloatButton, Alert } from 'antd';
import {
  ReloadOutlined,
  DownloadOutlined,
  DashboardOutlined,
  ClockCircleOutlined,
  SafetyOutlined,
  MedicineBoxOutlined,
  UnorderedListOutlined,
  RadarChartOutlined,
  SunOutlined,
  MoonOutlined,
  VerticalAlignTopOutlined,
  WarningOutlined,
  LoadingOutlined,
  GlobalOutlined,
  QuestionCircleOutlined,
  FileTextOutlined,
  CloudUploadOutlined,
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
import NetLogRequestList from './components/NetLogRequestList';
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
  const [activeTab, setActiveTab] = useState('overview');
  const [eventsSearch, setEventsSearch] = useState('');
  const { mode, toggleTheme } = useTheme();

  useEffect(() => {
    const handleScroll = () => {
      setShowBackTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleFileLoaded = (data: unknown) => {
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
    { key: 'requests', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><GlobalOutlined />图列预览</span>, children: result ? <NetLogRequestList result={result} /> : null },
    { key: 'diagnosis', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MedicineBoxOutlined />定因诊断</span>, children: result ? <DiagnosisTab result={result} /> : null },
    { key: 'events', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><UnorderedListOutlined />事件列表</span>, children: <EventsTab events={events} initialSearch={eventsSearch} /> },
    { key: 'ssl-protocol', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><SafetyOutlined />安全与协议</span>, children: result ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <SSLTab result={result} />
        <ProtocolTab result={result} />
      </div>
    ) : null },
    { key: 'performance', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ClockCircleOutlined />性能分析</span>, children: result ? <PerformanceTab result={result} /> : null },
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* ====== Modern Header ====== */}
      <Header className="app-header">
        <div className="app-header-title">
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
              浏览器文件分析工具
            </h1>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
              Chrome / Edge NetLog 与 HAR 文件可视化分析
            </div>
          </div>
        </div>

        <div className="app-header-actions">
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
      <Content style={{ maxWidth: 1920, margin: '0 auto', padding: '24px clamp(20px, 3vw, 48px)', width: '100%', boxSizing: 'border-box' }}>
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
          <div style={{ maxWidth: 900, margin: '48px auto', display: 'flex', flexDirection: 'column', gap: 32 }}>
            <UploadZone onFileLoaded={handleFileLoaded} />

            {/* 使用说明 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <QuestionCircleOutlined style={{ fontSize: 16, color: 'var(--accent-blue)' }} />
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>不知道如何获取文件？</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* HAR 文件 */}
                <a
                  href="https://bytedance.larkoffice.com/wiki/NbIuwtlAKi0C1nk2SkdcLcjTnDb"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block',
                    padding: '20px 24px',
                    background: 'var(--bg-surface)',
                    borderRadius: 14,
                    border: '1px solid var(--border-color)',
                    textDecoration: 'none',
                    transition: 'all 0.2s',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--accent-blue)';
                    e.currentTarget.style.boxShadow = '0 4px 16px rgba(14, 165, 233, 0.12)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(99, 102, 241, 0.12))',
                        border: '1px solid rgba(14, 165, 233, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <FileTextOutlined style={{ fontSize: 18, color: '#0ea5e9' }} />
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>HAR 文件获取指南</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    通过浏览器 DevTools → Network 面板导出网络请求记录
                  </p>
                  <span style={{ fontSize: 12, color: 'var(--accent-blue)', marginTop: 8, display: 'inline-block' }}>
                    查看详细教程 →
                  </span>
                </a>

                {/* NetLog 文件 */}
                <a
                  href="https://bytedance.larkoffice.com/docx/NfwtdMpCLoh04yx0xnec1PXCnnf"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block',
                    padding: '20px 24px',
                    background: 'var(--bg-surface)',
                    borderRadius: 14,
                    border: '1px solid var(--border-color)',
                    textDecoration: 'none',
                    transition: 'all 0.2s',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = '#6366f1';
                    e.currentTarget.style.boxShadow = '0 4px 16px rgba(99, 102, 241, 0.12)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(139, 92, 246, 0.12))',
                        border: '1px solid rgba(99, 102, 241, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <CloudUploadOutlined style={{ fontSize: 18, color: '#6366f1' }} />
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>NetLog 文件获取指南</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    通过 chrome://net-export/ 或 edge://net-export/ 导出网络日志
                  </p>
                  <span style={{ fontSize: 12, color: '#6366f1', marginTop: 8, display: 'inline-block' }}>
                    查看详细教程 →
                  </span>
                </a>
              </div>
            </div>
          </div>
        ) : fileType === 'har' && harResult ? (
          <HarResultPage result={harResult} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {result && <SummaryCards result={result} onNavigate={(tab, search) => { setActiveTab(tab); if (search) setEventsSearch(search); }} />}
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
                activeKey={activeTab}
                onChange={setActiveTab}
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
