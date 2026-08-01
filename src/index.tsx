import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ThemeProvider } from './theme';
import { maybeRunNetlogBrowserBenchmark } from './benchmark/netlogBrowserBenchmark';

const runWorkbenchBenchmark = process.env.REACT_APP_ENABLE_WORKBENCH_BENCHMARK === '1'
  && new URLSearchParams(window.location.search).get('workbench-benchmark') === '1';

if (runWorkbenchBenchmark) {
  import('./benchmark/workbenchBrowserBenchmark').then(
    ({ maybeRunWorkbenchBrowserBenchmark }) => maybeRunWorkbenchBrowserBenchmark(),
    () => {
      const root = document.getElementById('root');
      if (root) root.textContent = 'Workbench benchmark 加载失败';
    },
  );
} else if (!maybeRunNetlogBrowserBenchmark()) {
  const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
  );
  root.render(
    <React.StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </React.StrictMode>
  );
}
