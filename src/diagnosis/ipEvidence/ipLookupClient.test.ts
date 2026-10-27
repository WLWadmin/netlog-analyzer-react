import { lookupIpViaProxy, resetIpLookupBudgetForTest, shouldLookupIp } from './ipLookupClient';

it.each([
  '203.0.113.8', '192.0.2.1', '198.51.100.8', '100.64.0.1', '100.127.255.255',
  '198.18.0.1', '198.19.255.255', '192.0.0.1',
  'not:an:ip', '2001:::1', '::ffff:192.168.1.1', '::ffff:c0a8:101',
  '0:0:0:0:0:ffff:7f00:1', '::ffff:203.0.113.8',
  'fe90::1', 'ff02::1', '0:0:0:0:0:0:0:1', '2001:0db8:0:0:0:0:0:1',
])('never sends invalid or non-public address %s to the proxy', async ip => {
  resetIpLookupBudgetForTest();
  const fetchMock = jest.spyOn(global, 'fetch');
  expect(shouldLookupIp(ip)).toBe(false);
  const result = await lookupIpViaProxy(ip);
  expect(result.status).toBe('fail');
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockRestore();
});

it.each(['1.1.1.1', '8.8.8.8', '192.0.0.9', '192.0.0.10', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
  'continues to allow valid public address %s',
  ip => expect(shouldLookupIp(ip)).toBe(true),
);
