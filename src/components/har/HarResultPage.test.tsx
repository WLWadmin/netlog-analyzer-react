import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { parseHar } from '../../harParser';
import HarResultPage from './HarResultPage';
import { NavigationProvider, useNavigation } from '../../contexts/NavigationContext';

jest.mock('antd', () => ({
  Alert: ({ message, description }: { message: React.ReactNode; description: React.ReactNode }) => <div><span>{message}</span>{description}</div>,
}));
jest.mock('@ant-design/icons', () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});
jest.mock('./HarSummaryCards', () => ({
  __esModule: true,
  default: ({ onFilterFailed, onFilterSlow, onFilterAll }: {
    onFilterFailed: () => void;
    onFilterSlow: () => void;
    onFilterAll: () => void;
  }) => (
    <div>
      <button onClick={onFilterFailed}>失败请求</button>
      <button onClick={onFilterSlow}>慢请求</button>
      <button onClick={onFilterAll}>所有请求</button>
    </div>
  ),
}));
jest.mock('./HarRequestTable', () => ({
  __esModule: true,
  default: ({ statusFilter, categoryFilter }: { statusFilter: string; categoryFilter: string }) => (
    <div data-testid="request-filters">{statusFilter}:{categoryFilter}</div>
  ),
}));
jest.mock('./HarNoviceDiagnosisOverview', () => ({
  __esModule: true, default: () => <div>现象诊断</div>,
}));
jest.mock('./HarRecoveryPanel', () => ({
  __esModule: true, default: () => null,
}));
jest.mock('../raw/RawEvidenceExplorer', () => ({
  __esModule: true, default: () => <div>原始数据</div>,
}));
jest.mock('../shared/AnalysisDisclaimer', () => ({
  AnalysisDisclaimer: () => null,
}));

const result = parseHar({ log: { version: '1.2', entries: [] } });

describe('HAR persistent request overview', () => {
  it('warns about missing timings and navigates with the actual affected request IDs', () => {
    const incomplete = parseHar({ log: { entries: [{
      request: { url: 'https://example.test/', headers: [] }, response: { status: 200, headers: [], content: {} },
      time: 100, timings: {},
    }] } });
    function IntentProbe() {
      const { intent } = useNavigation();
      return <div data-testid="intent-ids">{intent?.filters?.requestIds?.join(',')}</div>;
    }
    const onTabChange = jest.fn();
    render(<NavigationProvider><HarResultPage result={incomplete} onTabChange={onTabChange} /><IntentProbe /></NavigationProvider>);
    expect(screen.getByRole('region', { name: '文件质量校验报告' })).toBeInTheDocument();
    const waitPath = screen.getByText('$.log.entries[0].timings.wait');
    expect(waitPath).toBeInTheDocument();
    fireEvent.click(waitPath.closest('details')!.querySelector('summary')!);
    fireEvent.click(screen.getAllByRole('button', { name: '定位证据' })[0]);
    expect(onTabChange).toHaveBeenCalledWith('requests');
    expect(screen.getByTestId('intent-ids')).toHaveTextContent('0');
  });
  it.each(['summary', 'requests', 'raw-evidence'])('keeps overview before %s content', activeTab => {
    const { container } = render(<HarResultPage result={result} activeTab={activeTab} rawData={{ log: {} }} />);
    const summary = screen.getByRole('region', { name: '请求概览' });
    const content = container.querySelector('.har-result-content');
    expect(content).not.toBeNull();
    expect(summary.nextElementSibling).toBe(content);
  });

  it.each([
    ['失败请求', 'failed'],
    ['慢请求', 'slow'],
    ['所有请求', 'all'],
  ])('navigates from raw evidence using %s and its actual filter', (label, filter) => {
    const onTabChange = jest.fn();
    const { rerender } = render(
      <HarResultPage result={result} activeTab="raw-evidence" onTabChange={onTabChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(onTabChange).toHaveBeenCalledWith('requests');
    rerender(<HarResultPage result={result} activeTab="requests" onTabChange={onTabChange} />);
    expect(screen.getByTestId('request-filters').textContent).toBe(`${filter}:all`);
    expect(screen.getByRole('region', { name: '请求概览' }).getAttribute('data-summary-filter')).toBe(filter);
  });
});
