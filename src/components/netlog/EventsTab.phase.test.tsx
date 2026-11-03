import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import EventsTab from './EventsTab';
import { parseLog } from '../../parsers/netlog/parser';
import type { IndexedEvent } from '../../parsers/shared/evidenceIndex';
import { NavigationProvider } from '../../contexts/NavigationContext';

jest.mock('antd', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Spin: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tag: ({ children, color }: { children: React.ReactNode; color: string }) => <span data-color={color}>{children}</span>,
  Button: ({ children, onClick }: { children: React.ReactNode; onClick(): void }) => <button onClick={onClick}>{children}</button>,
  Input: ({ placeholder, value, onChange }: React.InputHTMLAttributes<HTMLInputElement>) => <input placeholder={placeholder} value={value} onChange={onChange} />,
  Select: ({ placeholder, value, onChange, options }: { placeholder: string; value?: string; onChange(value: string): void; options: Array<{ value: string; label: string }> }) => (
    <select aria-label={placeholder} value={value || ''} onChange={event => onChange(event.target.value)}>
      <option value="">全部</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
  Table: ({ dataSource, columns }: { dataSource: IndexedEvent[]; columns: Array<{ key: string; render(value: string): React.ReactNode }> }) => (
    <div data-testid="events">{dataSource.map(row => <div key={row.originalIndex}>{columns.find(column => column.key === 'phase')?.render(row.phaseName)}</div>)}</div>
  ),
  Pagination: () => null,
  Modal: () => null,
}));

it('renders the ordinary parser bare phase names with the existing colors and name filters', () => {
  const { events } = parseLog({
    events: [0, 1, 2].map(phase => ({
      time: String(phase + 1), type: 2, phase, source: { id: 7, type: 1 }, params: {},
    })),
  });
  render(<NavigationProvider><EventsTab events={events} /></NavigationProvider>);
  const table = within(screen.getByTestId('events'));
  expect(table.getByText('NONE').getAttribute('data-color')).toBe('default');
  expect(table.getByText('BEGIN').getAttribute('data-color')).toBe('green');
  expect(table.getByText('END').getAttribute('data-color')).toBe('blue');
  for (const name of ['NONE', 'BEGIN', 'END']) {
    fireEvent.change(screen.getByLabelText('阶段筛选'), { target: { value: name } });
    expect(table.getByText(name)).not.toBeNull();
    expect(table.getAllByText(/^(NONE|BEGIN|END)$/)).toHaveLength(1);
  }
});
