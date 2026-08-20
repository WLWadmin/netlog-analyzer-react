import { COMMAND_LIBRARY } from './commandLibrary';

describe('network troubleshooting command library', () => {
  it('保留常用自查命令并说明 ICMP 证据边界', () => {
    const commands = COMMAND_LIBRARY.map(item => item.command).join('\n');
    const ping = COMMAND_LIBRARY.find(item => item.id === 'conn-ping');

    expect(commands).toContain('nslookup');
    expect(commands).toContain('dig ');
    expect(commands).toContain('ping ');
    expect(commands).toContain('tracert ');
    expect(commands).toContain('traceroute ');
    expect(ping?.expectedResult).toContain('不等于 HTTP/TCP 不可达');
    expect(JSON.stringify(COMMAND_LIBRARY)).not.toMatch(/丢包率\s*[<＜]\s*5%|延迟\s*[<＜]\s*200ms/);
  });

  it('国内公共 DNS 只作为临时对照并要求恢复原设置', () => {
    const dnsReference = COMMAND_LIBRARY.find(item => item.id === 'dns-lookup-reference');
    const text = JSON.stringify(dnsReference);

    expect(text).toContain('223.5.5.5');
    expect(text).toContain('223.6.6.6');
    expect(text).toContain('119.29.29.29');
    expect(text).toContain('180.76.76.76');
    expect(text).toContain('测试后恢复');
    expect(text).toContain('首轮不默认选择 8.8.8.8、114.114.114.114');
    expect(text).toContain('差异只作为 DNS 路径或调度线索');
  });
});
