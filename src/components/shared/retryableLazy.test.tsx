import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { retryableLazy } from './retryableLazy';

jest.mock('antd', () => ({
  Alert: ({ message, description, action }: { message: string; description: string; action: React.ReactNode }) => (
    <div role="alert">{message}{description}{action}</div>
  ),
  Button: ({ children, onClick }: { children: React.ReactNode; onClick(): void }) => <button onClick={onClick}>{children}</button>,
}));

it('retries a rejected import with a new lazy instance while retaining parent data', async () => {
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  const loader = jest.fn<Promise<{ default: React.ComponentType<{ value: string }> }>, []>()
    .mockRejectedValueOnce(new Error('chunk unavailable'))
    .mockResolvedValue({ default: ({ value }) => <div>结果：{value}</div> });
  const Result = retryableLazy(loader);
  function Parent() {
    const [value, setValue] = useState('原分析');
    return <>
      <input aria-label="保留的数据" value={value} onChange={event => setValue(event.target.value)} />
      <Result value={value} />
    </>;
  }
  try {
    render(<Parent />);
    fireEvent.change(screen.getByLabelText('保留的数据'), { target: { value: '已解析数据' } });
    fireEvent.click(await screen.findByRole('button', { name: '重试此功能' }));
    expect(await screen.findByText('结果：已解析数据')).not.toBeNull();
    expect(loader).toHaveBeenCalledTimes(2);
  } finally {
    errorLog.mockRestore();
  }
});

it('prepares code without mounting a view and tolerates a preparation failure', async () => {
  const view = jest.fn(() => <div>已准备视图</div>);
  const loader = jest.fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ default: view });
  const Result = retryableLazy(loader);
  await expect(Result.preload()).resolves.toBeUndefined();
  await Result.preload();
  expect(view).not.toHaveBeenCalled();
  render(<Result />);
  expect(await screen.findByText('已准备视图')).not.toBeNull();
});
