import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { parseHar } from '../../harParser';
import HarRequestTable from './HarRequestTable';

jest.mock('@rc-component/picker/locale/en_US', () => (
  jest.requireActual('@rc-component/picker/lib/locale/en_US')
), { virtual: true });

// Load the real controls directly: Jest 27 cannot resolve picker export aliases
// pulled in by the unrelated Calendar component in the Ant Design barrel.
jest.mock('antd', () => ({
  Table: jest.requireActual('antd/lib/table').default,
  Input: jest.requireActual('antd/lib/input').default,
  Tag: jest.requireActual('antd/lib/tag').default,
  Badge: jest.requireActual('antd/lib/badge').default,
  Spin: jest.requireActual('antd/lib/spin').default,
  Button: jest.requireActual('antd/lib/button').default,
  Tooltip: jest.requireActual('antd/lib/tooltip').default,
  Select: jest.requireActual('antd/lib/select').default,
}));

jest.mock('../../contexts/NavigationContext', () => ({
  useNavigation: () => ({ intent: null, consumeIntent: jest.fn() }),
}));
jest.mock('./HarRequestDetail', () => () => <div>Request detail</div>);
jest.mock('./HarWaterfallCell', () => () => <div>Waterfall</div>);
jest.mock('./HarTimelineOverview', () => () => <div>Timeline</div>);

let observedResize: (() => void) | undefined;

beforeAll(() => {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: TestPointerEvent });
  // Ant Design schedules select dismissal through MessageChannel, absent in JSDOM.
  Object.defineProperty(window, 'MessageChannel', {
    configurable: true,
    value: class {
      port1: { onmessage?: () => void } = {};
      port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0) };
    },
  });
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.hasPointerCapture = jest.fn(() => true);
  HTMLElement.prototype.releasePointerCapture = jest.fn();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({
      matches: false,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }),
  });
  // Width observation is not available in JSDOM.
  window.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) { observedResize = () => callback([], this); }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function result(count = 2) {
  return parseHar({ log: { entries: Array.from({ length: count }, (_, i) => ({
    request: { method: 'GET', url: `https://long-subdomain.example.test/request-${i}`, headers: [] },
    response: { status: 200, headers: [], content: {} },
    time: i + 1,
    timings: { send: 0, wait: i + 1, receive: 0 },
  })) } });
}

it('initializes compact columns equally and divides spare space between Name and Domain', () => {
  render(<HarRequestTable result={result()} />);
  const width = (label: string) => Number(screen.getByRole('separator', { name: `调整 ${label} 列宽` }).getAttribute('aria-valuenow'));
  ['Status', '主问题', 'Protocol', 'Type', 'Size', 'Time'].forEach(label => expect(width(label)).toBe(112));
  expect(width('Name')).toBe(width('Domain'));
  expect(width('Waterfall')).toBe(300);
});

it('updates both header and body during dragging, retains capture across frames and restores cancelled widths', async () => {
  const { container } = render(<HarRequestTable result={result()} />);
  const name = screen.getByRole('separator', { name: '调整 Name 列宽' });
  const domain = screen.getByRole('separator', { name: '调整 Domain 列宽' });
  const nameWidth = Number(name.getAttribute('aria-valuenow'));
  const domainWidth = Number(domain.getAttribute('aria-valuenow'));
  fireEvent.pointerDown(name, { button: 0, pointerId: 1, clientX: 200 });
  fireEvent.pointerMove(name, { pointerId: 1, clientX: 220 });
  await waitFor(() => expect(name).toHaveAttribute('aria-valuenow', String(nameWidth + 20)));
  expect(domain).toHaveAttribute('aria-valuenow', String(domainWidth - 20));
  expect(container.querySelector(`col[style*="width: ${nameWidth + 20}px"]`)).not.toBeNull();
  expect(name).toHaveClass('is-resizing');
  fireEvent.pointerMove(name, { pointerId: 1, clientX: 240 });
  await waitFor(() => expect(name).toHaveAttribute('aria-valuenow', String(nameWidth + 40)));
  fireEvent.pointerCancel(name, { pointerId: 1 });
  expect(name).toHaveAttribute('aria-valuenow', String(nameWidth));
  expect(domain).toHaveAttribute('aria-valuenow', String(domainWidth));
});

it('resizes columns in the real Ant Design table while preserving sorting and filtering', async () => {
  const { container } = render(<HarRequestTable result={result()} />);
  const domain = screen.getByRole('separator', { name: '调整 Domain 列宽' });
  expect(screen.getAllByRole('separator')).toHaveLength(9);
  const originalWidth = Number(domain.getAttribute('aria-valuenow'));
  fireEvent.keyDown(domain, { key: 'ArrowRight' });
  await waitFor(() => expect(domain).toHaveAttribute('aria-valuenow', String(originalWidth + 16)));
  // Header and body colgroups must share the updated width.
  expect(container.querySelector(`col[style*="width: ${originalWidth + 16}px"]`)).not.toBeNull();
  const status = screen.getByRole('columnheader', { name: /Status/ });
  fireEvent.click(status);
  expect(status).toHaveAttribute('aria-sort', 'ascending');
  expect(domain).toHaveAttribute('aria-valuenow', String(originalWidth + 16));
  fireEvent.change(screen.getByPlaceholderText('按 URL 关键词过滤'), {
    target: { value: 'request-1' },
  });
  expect(screen.getByText(/共 1 条请求/)).toBeInTheDocument();
  expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(1);
  expect(domain).toHaveAttribute('aria-valuenow', String(originalWidth + 16));
});

it('uses the same resizable headers on the large-file virtual table path', () => {
  render(<HarRequestTable result={result(501)} />);
  const domain = screen.getByRole('separator', { name: '调整 Domain 列宽' });
  const originalWidth = Number(domain.getAttribute('aria-valuenow'));
  const maximum = Number(domain.getAttribute('aria-valuemax'));
  const originalBudget = screen.getAllByRole('separator').reduce((sum, cell) => sum + Number(cell.getAttribute('aria-valuenow')), 0);
  fireEvent.pointerDown(domain, { button: 0, pointerId: 1, clientX: 200 });
  fireEvent.pointerMove(domain, { pointerId: 1, clientX: 400 });
  expect(domain).toHaveAttribute('aria-valuenow', String(originalWidth));
  fireEvent.pointerUp(domain, { pointerId: 1, clientX: 400 });
  expect(domain).toHaveAttribute('aria-valuenow', String(maximum));
  expect(screen.getAllByRole('separator').reduce((sum, cell) => sum + Number(cell.getAttribute('aria-valuenow')), 0)).toBe(originalBudget);
  screen.getAllByRole('separator').forEach(cell => {
    expect(Number(cell.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(Number(cell.getAttribute('aria-valuemin')));
  });
});

it('makes optional columns resizable and retains widths when filter controls collapse', async () => {
  render(<HarRequestTable result={result()} />);
  fireEvent.click(screen.getByRole('button', { name: '更多筛选' }));
  const selectors = screen.getAllByRole('combobox');
  const selector = selectors[selectors.length - 1];
  fireEvent.mouseDown(selector);
  fireEvent.click(await screen.findByText('Remote Address'));
  const remote = screen.getByRole('separator', { name: '调整 Remote Address 列宽' });
  const originalWidth = Number(remote.getAttribute('aria-valuenow'));
  const expectedWidth = Math.min(originalWidth + 16, Number(remote.getAttribute('aria-valuemax')));
  fireEvent.keyDown(remote, { key: 'ArrowRight' });
  expect(remote).toHaveAttribute('aria-valuenow', String(expectedWidth));
  fireEvent.click(screen.getByRole('button', { name: '收起更多筛选' }));
  expect(screen.getByRole('separator', { name: '调整 Remote Address 列宽' }))
    .toHaveAttribute('aria-valuenow', String(expectedWidth));
});

it('refits to container changes without shrinking any column below its minimum', () => {
  const { container } = render(<HarRequestTable result={result()} />);
  const wrapper = container.firstElementChild as HTMLElement;
  jest.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({ width: 1200 } as DOMRect);
  act(() => observedResize?.());
  const widths = () => screen.getAllByRole('separator').map(cell => Number(cell.getAttribute('aria-valuenow')));
  expect(widths().reduce((sum, width) => sum + width, 0)).toBe(1200);
  const body = container.querySelector('.ant-table-body') as HTMLElement;
  Object.defineProperty(body, 'offsetWidth', { configurable: true, value: 1200 });
  Object.defineProperty(body, 'clientWidth', { configurable: true, value: 1182 });
  act(() => observedResize?.());
  expect(widths().reduce((sum, width) => sum + width, 0)).toBe(1182);
  jest.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({ width: 600 } as DOMRect);
  act(() => observedResize?.());
  screen.getAllByRole('separator').forEach(cell => {
    expect(Number(cell.getAttribute('aria-valuenow'))).toBe(Number(cell.getAttribute('aria-valuemin')));
  });
  expect(screen.getByText(/当前列的最小宽度超过可用空间/)).toBeInTheDocument();
});
