import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button, Card } from 'antd';
import { ReloadOutlined, BugOutlined } from '@ant-design/icons';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--bg-base)',
        }}>
          <Card style={{
            maxWidth: 500,
            width: '100%',
            background: 'var(--bg-elevated)',
            borderColor: 'var(--border-color)',
            borderRadius: 14,
          }}>
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'rgba(248, 113, 113, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
              }}>
                <BugOutlined style={{ fontSize: 32, color: '#f87171' }} />
              </div>
              <h2 style={{ color: 'var(--text-primary)', marginBottom: 12, fontSize: 18 }}>
                遇到一些问题
              </h2>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.6, fontSize: 14 }}>
                解析文件时发生错误，可能是文件格式不兼容或数据损坏。
                <br />
                请尝试重新上传文件，或检查文件是否完整。
              </p>
              {this.state.error && (
                <div style={{
                  background: 'var(--bg-surface)',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 20,
                  textAlign: 'left',
                  fontSize: 12,
                }}>
                  <div style={{ color: '#f87171', marginBottom: 6, fontWeight: 600 }}>
                    错误信息：
                  </div>
                  <code style={{
                    color: 'var(--text-secondary)',
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                    fontSize: 11,
                  }}>
                    {this.state.error.message}
                  </code>
                </div>
              )}
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                onClick={this.handleReset}
                style={{
                  background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                  border: 'none',
                  height: 40,
                  padding: '0 24px',
                  borderRadius: 10,
                }}
              >
                重新上传文件
              </Button>
            </div>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}
