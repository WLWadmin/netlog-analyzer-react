import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DatasetEventsTab from './DatasetEventsTab';
import { NavigationProvider, useNavigation } from '../../contexts/NavigationContext';
import { queryNetlogEventsInWorker } from '../../workers/workerClient';
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
  Table: ({ dataSource }: { dataSource: Array<{ eventId: number }> }) => <div>{dataSource.map(row => <div key={row.eventId}>event#{row.eventId}</div>)}</div>,
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Modal: () => null,
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
