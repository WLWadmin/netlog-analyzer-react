import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import IpLookupPanel from './IpLookupPanel';
import { lookupIpViaProxy } from '../../diagnosis/ipEvidence/ipLookupClient';
import type { IpLookupResult } from '../../diagnosis/ipEvidence/ipLookupTypes';
import { copyText } from '../../utils/copyText';

jest.mock('../../diagnosis/ipEvidence/ipLookupClient', () => ({
  ...jest.requireActual('../../diagnosis/ipEvidence/ipLookupClient'),
  lookupIpViaProxy: jest.fn(),
}));
jest.mock('../../utils/copyText', () => ({ copyText: jest.fn() }));

const lookup = jest.mocked(lookupIpViaProxy);
const copy = jest.mocked(copyText);
const success: IpLookupResult = {
  ip: '1.1.1.1',
  status: 'success',
  country: '示例国家',
  regionName: '示例地区',
  city: '示例城市',
  isp: '示例运营商',
  org: '示例组织',
  as: 'AS64500',
  asname: 'EXAMPLE',
  timezone: 'Example/Zone',
};

function submit(ip = '1.1.1.1') {
  fireEvent.change(screen.getByRole('textbox', { name: '待查询的 IP 地址' }), { target: { value: ip } });
  fireEvent.click(screen.getByRole('button', { name: '查询归属' }));
}

beforeEach(() => {
  lookup.mockReset();
  copy.mockReset();
  copy.mockResolvedValue();
});

it('starts empty and never queries until the user submits a public IP', () => {
  render(<IpLookupPanel />);
  expect(lookup).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '复制归属信息' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查询归属' }));
  expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
  expect(lookup).not.toHaveBeenCalled();
});

it.each(['192.168.1.8', '203.0.113.8', '100.64.0.1', '::ffff:192.168.1.8', 'not:an:ip'])(
  'keeps non-public or invalid input %s inside the browser',
  ip => {
    render(<IpLookupPanel />);
    submit(ip);
    expect(lookup).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('不会外发');
  },
);

it('shows all attribution fields without a disclosure and copies only displayed attribution', async () => {
  lookup.mockResolvedValue(success);
  const { container } = render(<IpLookupPanel />);
  submit(' 1.1.1.1 ');
  await screen.findByRole('button', { name: '复制归属信息' });
  expect(lookup).toHaveBeenCalledWith('1.1.1.1');
  expect(screen.getAllByText('示例运营商')).toHaveLength(2);
  expect(screen.getByText('示例国家 · 示例地区 · 示例城市')).not.toBeNull();
  expect(screen.getByText('示例组织')).not.toBeNull();
  expect(screen.getByText('AS64500')).not.toBeNull();
  expect(screen.getByText('EXAMPLE')).not.toBeNull();
  expect(screen.getByText('Example/Zone')).not.toBeNull();
  expect(container.querySelector('details')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '复制归属信息' }));
  await waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
  expect(copy.mock.calls[0][0]).toContain('自治系统 / ASN：AS64500');
  expect(copy.mock.calls[0][0]).toContain('数据库版本：未提供');
  expect(copy.mock.calls[0][0]).not.toContain('status');
});

it('does not invent missing provider fields', async () => {
  lookup.mockResolvedValue({ ip: '1.1.1.1', status: 'success' });
  render(<IpLookupPanel />);
  submit();
  await screen.findByRole('button', { name: '复制 IP' });
  expect(screen.getAllByText('未提供').length).toBeGreaterThan(5);
  expect(screen.queryByText('其他运营商 / IDC')).toBeNull();
});

it('clears stale results while editing and ignores an older query response', async () => {
  let resolveFirst: (result: IpLookupResult) => void = () => {};
  lookup.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
  lookup.mockResolvedValueOnce({ ...success, ip: '8.8.8.8', isp: '第二次查询' });
  const { container } = render(<IpLookupPanel />);
  submit();
  expect(screen.getByRole('button', { name: '查询中…' }).hasAttribute('disabled')).toBe(true);
  submit('8.8.8.8');
  await screen.findByText('第二次查询', { selector: '.ip-lookup-fields dd' });
  await act(async () => { resolveFirst(success); });
  expect(container.querySelector('.ip-lookup-result-heading strong')?.textContent).toBe('8.8.8.8');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
  expect(screen.queryByRole('button', { name: '复制 IP' })).toBeNull();
});

it('preserves input and permits retry without exposing transport error details', async () => {
  lookup.mockResolvedValueOnce({ ip: '1.1.1.1', status: 'fail', message: 'HTTP 502 transport details' });
  lookup.mockResolvedValueOnce(success);
  render(<IpLookupPanel />);
  submit();
  await screen.findByText('查询服务暂时不可用，请稍后重试。');
  expect(screen.queryByText(/transport details/)).toBeNull();
  expect(screen.getByRole('textbox').getAttribute('value')).toBe('1.1.1.1');
  fireEvent.click(screen.getByRole('button', { name: '查询归属' }));
  await screen.findByRole('button', { name: '复制 IP' });
});

it('reports rate limiting and copy failures with actionable text', async () => {
  lookup.mockResolvedValueOnce({ ip: '1.1.1.1', status: 'fail', message: 'HTTP 429' });
  lookup.mockResolvedValueOnce(success);
  copy.mockRejectedValue(new Error('unavailable'));
  render(<IpLookupPanel />);
  submit();
  await screen.findByText('查询频率受限，请稍后重试。');
  fireEvent.click(screen.getByRole('button', { name: '查询归属' }));
  await screen.findByRole('button', { name: '复制 IP' });
  fireEvent.click(screen.getByRole('button', { name: '复制 IP' }));
  await screen.findByText('复制失败，请选中文本复制。');
});
