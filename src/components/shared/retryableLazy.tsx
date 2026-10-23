import { Component, createElement, lazy, Suspense, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Alert, Button } from 'antd';

class ModuleBoundary extends Component<
  { children: ReactNode; onRetry(): void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Alert type="warning" showIcon message="此功能暂时无法加载或显示"
        description="当前分析数据仍保留。请重试；若站点刚更新且旧资源已不可用，请先保存其他可用结果，再自行重新载入页面。"
        action={<Button onClick={this.props.onRetry}>重试此功能</Button>} />
    );
  }
}

// React.lazy caches a rejected promise. A retry must create a new lazy type,
// while the uploaded data and Worker session remain owned by the parent.
export function retryableLazy<P extends object>(loader: () => Promise<{ default: ComponentType<P> }>) {
  let Loaded = lazy(loader);
  function RetryableModule(props: P) {
    const [attempt, setAttempt] = useState(0);
    return (
      <ModuleBoundary key={attempt} onRetry={() => {
        Loaded = lazy(loader);
        setAttempt(value => value + 1);
      }}>
        <Suspense fallback={<div role="status" style={{ padding: 24 }}>正在加载功能…</div>}>
          {createElement(Loaded, props)}
        </Suspense>
      </ModuleBoundary>
    );
  }
  // Preparing code must neither mount views nor turn an unavailable chunk into
  // a parse failure. A visible view can retry its own import later.
  return Object.assign(RetryableModule, {
    preload: () => loader().then(() => undefined, () => undefined),
  });
}
