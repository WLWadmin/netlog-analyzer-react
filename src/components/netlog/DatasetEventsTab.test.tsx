import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DatasetEventsTab from './DatasetEventsTab';
import { NavigationProvider, useNavigation } from '../../contexts/NavigationContext';
import { getNetlogEventDetailInWorker, queryNetlogEventsInWorker } from '../../workers/workerClient';
import { saveDatasetEventsFilterState } from './datasetEventsFilterState';
import type { QueryNetlogEventsResult } from '../../workers/netlogDatasetQuery';

jest.mock('../../workers/workerClient', () => ({
  queryNetlogEventsInWorker: jest.fn(),
  getNetlogEventDetailInWorker: jest.fn(),
}));
jest.mock('antd', () => ({
  Alert: ({ message }: { message: React.ReactNode }) => <div>{message}</div>,
  Card: ({ children, extra }: { children: React.ReactNode; extra: React.ReactNode }) => <div>{extra}{children}</div>,
  Space: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick }: { children: React.ReactNode; onClick(): void }) => <button onClick={onClick}>{children}</button>,
  Input: Object.assign(
    ({ value, onChange, placeholder }: React.InputHTMLAttributes<HTMLInputElement>) => <input value={value} onChange={onChange} placeholder={placeholder} />,
    { Search: () => <input aria-label="搜索" /> },
  ),
  Table: ({ dataSource, columns }: { dataSource: Array<{ eventId: number }>; columns: Array<{ title: string; render?: (value: undefined, row: { eventId: number }) => React.ReactNode }> }) => <div>{dataSource.map(row => <div key={row.eventId}>event#{row.eventId}{columns.find(column => column.title === 'Detail')?.render?.(undefined, row)}</div>)}</div>,
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Modal: ({ children, open, onCancel }: { children: React.ReactNode; open: boolean; onCancel(): void }) => open ? <div><button onClick={onCancel}>关闭详情</button>{children}</div> : null,
  message: { error: jest.fn() },
}));

function EvidenceJump() {
  const { navigateTo } = useNavigation();
  return <button onClick={() => navigateTo({
    tab: 'expert', fileType: 'netlog', filters: { sourceId: '7' },
  })}>请求结束证据</button>;
}

it('clears stale error and time filters on a source jump and rejects the older response', async () => {
  localStorage.clear();
  saveDatasetEventsFilterState('dataset-navigation', {
    errorOnly: true, sourceIdFilter: '', sourceChainIdFilter: '', typeIdFilter: '',
    typeNameFilter: 'OLD_EVENT', sourceTypeNameFilter: '', phaseFilter: '',
    startTimeFilter: '1000', endTimeFilter: '2000', searchTextFilter: '', pageSize: 100,
  });
  let resolveOld: (value: QueryNetlogEventsResult) => void = () => {};
  const query = jest.mocked(queryNetlogEventsInWorker);
  const empty: QueryNetlogEventsResult = { analysisId: 'dataset-navigation', page: 1, pageSize: 100, total: 0, rows: [] };
  query.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  query.mockResolvedValue(empty);
  render(<NavigationProvider><EvidenceJump /><DatasetEventsTab analysisId="dataset-navigation" /></NavigationProvider>);
  await waitFor(() => expect(query).toHaveBeenCalledWith(expect.objectContaining({ errorOnly: true, startTime: 1000 })));
  fireEvent.click(screen.getByText('请求结束证据'));
  await waitFor(() => expect(query).toHaveBeenLastCalledWith(expect.objectContaining({
    sourceId: 7, errorOnly: false, typeName: undefined, startTime: undefined, endTime: undefined,
  })));
  await act(async () => resolveOld({
    ...empty, total: 1, rows: [{ eventId: 999, sourceId: 9, typeId: 1, typeName: 'OLD_EVENT',
      sourceTypeId: 1, sourceTypeName: 'URL_REQUEST', phase: 0, phaseName: 'NONE', time: 1000, hasError: true, byteStart: 0, byteEnd: 1 }],
  }));
  expect(screen.queryByText('event#999')).toBeNull();
});

it('opens the exact quality event, supports repeat jumps and rejects stale detail responses', async () => {
  localStorage.clear();
  const query = jest.mocked(queryNetlogEventsInWorker);
  query.mockResolvedValue({ analysisId: 'quality', page: 1, pageSize: 100, total: 0, rows: [] });
  const detail = jest.mocked(getNetlogEventDetailInWorker);
  detail.mockReset();
  let resolveOld: (value: unknown) => void = () => {};
  detail.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  detail.mockResolvedValue({ qualityMarker: 'latest-detail' });
  function QualityJump() {
    const { navigateTo } = useNavigation();
    return <button onClick={() => navigateTo({
      tab: 'expert', fileType: 'netlog', filters: { sourceId: '7' }, scrollTo: { type: 'event', id: 42 },
    })}>校验事件</button>;
  }
  render(<NavigationProvider><QualityJump /><DatasetEventsTab analysisId="quality" /></NavigationProvider>);
  fireEvent.click(screen.getByText('校验事件'));
  await waitFor(() => expect(detail).toHaveBeenCalledWith({ analysisId: 'quality', eventId: 42 }));
  fireEvent.click(screen.getByText('校验事件'));
  await waitFor(() => expect(detail).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByText(/latest-detail/)).not.toBeNull());
  await act(async () => resolveOld({ qualityMarker: 'stale-detail' }));
  expect(screen.queryByText(/stale-detail/)).toBeNull();
});

it('rejects a pending manual detail when a quality jump opens a newer event', async () => {
  localStorage.clear();
  jest.mocked(queryNetlogEventsInWorker).mockResolvedValue({
    analysisId: 'race', page: 1, pageSize: 100, total: 1,
    rows: [{ eventId: 1, sourceId: 7, typeId: 1, typeName: 'URL_REQUEST',
      sourceTypeId: 1, sourceTypeName: 'URL_REQUEST', phase: 0, phaseName: 'NONE', time: 1, hasError: false, byteStart: 0, byteEnd: 1 }],
  });
  const detail = jest.mocked(getNetlogEventDetailInWorker);
  detail.mockReset();
  let resolveOld: (value: unknown) => void = () => {};
  detail.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  detail.mockResolvedValue({ marker: 'new-quality-event' });
  function Jump() {
    const { navigateTo } = useNavigation();
    return <button onClick={() => navigateTo({
      tab: 'expert', fileType: 'netlog', filters: { sourceId: '7' }, scrollTo: { type: 'event', id: 42 },
    })}>跳转校验详情</button>;
  }
  render(<NavigationProvider><Jump /><DatasetEventsTab analysisId="race" /></NavigationProvider>);
  fireEvent.click(await screen.findByText('查看'));
  fireEvent.click(screen.getByText('跳转校验详情'));
  await screen.findByText(/new-quality-event/);
  await act(async () => resolveOld({ marker: 'old-manual-event' }));
  expect(screen.queryByText(/old-manual-event/)).toBeNull();
});

it.each(['manual', 'close', 'session'] as const)('invalidates a pending navigation detail on %s', async action => {
  localStorage.clear();
  jest.mocked(queryNetlogEventsInWorker).mockResolvedValue({
    analysisId: 'race', page: 1, pageSize: 100, total: 1,
    rows: [{ eventId: 1, sourceId: 7, typeId: 1, typeName: 'URL_REQUEST',
      sourceTypeId: 1, sourceTypeName: 'URL_REQUEST', phase: 0, phaseName: 'NONE', time: 1, hasError: false, byteStart: 0, byteEnd: 1 }],
  });
  const detail = jest.mocked(getNetlogEventDetailInWorker);
  detail.mockReset();
  let rejectOld: (reason: Error) => void = () => {};
  detail.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectOld = reject; }));
  detail.mockResolvedValue({ marker: 'latest-manual-event' });
  function Jump() {
    const { navigateTo } = useNavigation();
    return <button onClick={() => navigateTo({
      tab: 'expert', fileType: 'netlog', filters: { sourceId: '7' }, scrollTo: { type: 'event', id: 42 },
    })}>打开待完成详情</button>;
  }
  const { rerender } = render(<NavigationProvider><Jump /><DatasetEventsTab analysisId="race" /></NavigationProvider>);
  fireEvent.click(screen.getByText('打开待完成详情'));
  await waitFor(() => expect(detail).toHaveBeenCalledTimes(1));
  if (action === 'manual') {
    fireEvent.click(await screen.findByText('查看'));
    await screen.findByText(/latest-manual-event/);
  } else if (action === 'close') {
    fireEvent.click(screen.getByText('关闭详情'));
  } else {
    rerender(<NavigationProvider><Jump /><DatasetEventsTab analysisId="new-session" /></NavigationProvider>);
  }
  await act(async () => rejectOld(new Error('old request failed')));
  expect(screen.queryByText(/读取失败/)).toBeNull();
  if (action === 'manual') expect(screen.queryByText(/latest-manual-event/)).not.toBeNull();
  else expect(screen.queryByText('关闭详情')).toBeNull();
});
