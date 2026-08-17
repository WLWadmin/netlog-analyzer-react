import { fireEvent, render, screen } from '@testing-library/react';
import ResultWorkbenchShell, { type ResultWorkbenchNavItem } from './ResultWorkbenchShell';

const items: ResultWorkbenchNavItem[] = [
  { key: 'summary', label: '结论', icon: <span>1</span>, group: '诊断' },
  { key: 'requests', label: '请求详情', icon: <span>2</span>, group: '诊断', count: 3 },
];

describe('ResultWorkbenchShell', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('forwards navigation and exposes the active destination', () => {
    const onChange = jest.fn();
    render(
      <ResultWorkbenchShell
        parser="har"
        parserLabel="HAR"
        statusLabel="3 个请求"
        activeKey="summary"
        items={items}
        onChange={onChange}
      >
        <div>内容</div>
      </ResultWorkbenchShell>,
    );

    expect(screen.getByRole('button', { name: '结论' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: '请求详情' }));
    expect(onChange).toHaveBeenCalledWith('requests');
  });

  it('persists collapse state independently for each parser', () => {
    const harView = render(
      <ResultWorkbenchShell
        parser="har"
        parserLabel="HAR"
        statusLabel="已加载"
        activeKey="summary"
        items={items}
        onChange={jest.fn()}
      >
        <div>HAR 内容</div>
      </ResultWorkbenchShell>,
    );

    fireEvent.click(screen.getByRole('button', { name: '收起分析导航' }));
    expect(window.localStorage.getItem('netlog-workbench-sidebar-collapsed-v1-har')).toBe('1');
    harView.unmount();

    render(
      <ResultWorkbenchShell
        parser="netlog"
        parserLabel="NetLog"
        statusLabel="已加载"
        activeKey="summary"
        items={items}
        onChange={jest.fn()}
      >
        <div>NetLog 内容</div>
      </ResultWorkbenchShell>,
    );

    expect(screen.getByRole('button', { name: '收起分析导航' })).not.toBeNull();
    expect(window.localStorage.getItem('netlog-workbench-sidebar-collapsed-v1-netlog')).toBeNull();
  });
});
