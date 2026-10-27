import { useEffect, useRef, useState } from 'react';
import { CopyOutlined, GlobalOutlined } from '@ant-design/icons';
import { lookupIpViaProxy, shouldLookupIp } from '../../diagnosis/ipEvidence/ipLookupClient';
import { getCarrierDisplayName } from '../../diagnosis/ipEvidence/ipLookupDiagnosis';
import { normalizeIp } from '../../diagnosis/ipEvidence/ipNormalize';
import type { IpLookupState } from '../../diagnosis/ipEvidence/ipLookupTypes';
import { copyText } from '../../utils/copyText';
import './ipLookupPanel.css';

const IpLookupPanel: React.FC = () => {
  const [input, setInput] = useState('');
  const [state, setState] = useState<IpLookupState>({ status: 'idle' });
  const [queriedAt, setQueriedAt] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [invalid, setInvalid] = useState(false);
  const generation = useRef(0);

  useEffect(() => () => { generation.current += 1; }, []);

  async function query() {
    if (state.status === 'loading') return;
    const ticket = ++generation.current;
    const ip = normalizeIp(input);
    setCopyStatus('');
    setInvalid(false);
    if (!ip) {
      setInvalid(true);
      setState({ status: 'failed', error: '请输入有效的公网 IP 地址。' });
      return;
    }
    if (!shouldLookupIp(ip)) {
      setState({ status: 'failed', error: '仅查询有效的公网 IP，内网、回环与保留地址不会外发。' });
      return;
    }

    setState({ status: 'loading' });
    try {
      const result = await lookupIpViaProxy(ip);
      if (ticket !== generation.current) return;
      if (result.status !== 'success') {
        // Proxy errors can contain transport details; expose only actionable text.
        const limited = /限流|频率|rate|limit|429/i.test(result.message || '');
        setState({
          status: 'failed',
          error: limited ? '查询频率受限，请稍后重试。' : '查询服务暂时不可用，请稍后重试。',
        });
        return;
      }
      setQueriedAt(new Date().toLocaleString('zh-CN'));
      setState({ status: 'success', result });
    } catch {
      if (ticket === generation.current) {
        setState({ status: 'failed', error: '查询服务暂时不可用，请稍后重试。' });
      }
    }
  }

  const result = state.status === 'success' ? state.result : undefined;
  const location = result
    ? [result.country, result.regionName, result.city].filter(Boolean).join(' · ') || '未提供'
    : '';
  const fields = result ? [
    ['IP 地址', result.ip],
    ['运营商 / ISP', result.isp || '未提供'],
    ['组织 / ORG', result.org || '未提供'],
    ['自治系统 / ASN', result.as || '未提供'],
    ['自治系统名称', result.asname || '未提供'],
    ['时区', result.timezone || '未提供'],
    ['数据来源', 'IP 查询代理'],
    ['数据库版本', '未提供'],
  ] : [];

  async function copy(text: string) {
    const ticket = generation.current;
    try {
      await copyText(text);
      if (ticket === generation.current) setCopyStatus('已复制');
    } catch {
      if (ticket === generation.current) setCopyStatus('复制失败，请选中文本复制。');
    }
  }

  return (
    <section className="ip-lookup-panel" aria-labelledby="home-ip-lookup-title">
      <header className="ip-lookup-heading">
        <div>
          <h2 id="home-ip-lookup-title"><GlobalOutlined aria-hidden="true" />IP 归属查询</h2>
          <p>查询运营商与地区，无需导入文件</p>
        </div>
        <span className="ip-lookup-tag">独立查询</span>
      </header>
      <form
        className="ip-lookup-form"
        aria-busy={state.status === 'loading'}
        onSubmit={event => { event.preventDefault(); void query(); }}
      >
        <input
          type="text"
          aria-label="待查询的 IP 地址"
          aria-describedby="home-ip-lookup-privacy"
          aria-invalid={invalid}
          value={input}
          placeholder="输入公网 IP 地址"
          autoComplete="off"
          spellCheck={false}
          onChange={event => {
            generation.current += 1;
            setInput(event.target.value);
            setState({ status: 'idle' });
            setInvalid(false);
            setCopyStatus('');
          }}
        />
        <button type="submit" disabled={state.status === 'loading'}>
          {state.status === 'loading' ? '查询中…' : '查询归属'}
        </button>
      </form>
      <p id="home-ip-lookup-privacy" className="ip-lookup-note">
        点击查询后，仅向外部服务发送该公网 IP，不上传日志文件。内网、回环与保留地址不会外发。
      </p>
      <p className="ip-lookup-feedback" role="status">
        {state.status === 'loading' ? '正在查询 IP 归属…' : state.error}
      </p>
      {result ? (
        <div className="ip-lookup-result">
          <div className="ip-lookup-result-heading">
            <strong>{result.ip}</strong><span>查询时间 {queriedAt}</span>
          </div>
          <div className="ip-lookup-brief">
            <div><span>运营商</span><strong>{result.isp || result.org || result.asname ? getCarrierDisplayName(result) : '未提供'}</strong></div>
            <div><span>归属地区</span><strong>{location}</strong></div>
          </div>
          <dl className="ip-lookup-fields" aria-label="完整归属信息">
            {fields.map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          <div className="ip-lookup-tools">
            <button type="button" onClick={() => { void copy(result.ip); }}><CopyOutlined aria-hidden="true" />复制 IP</button>
            <button type="button" onClick={() => {
              void copy([
                `归属地区：${location}`,
                ...fields.map(([label, value]) => `${label}：${value}`),
                `查询时间：${queriedAt}`,
              ].join('\n'));
            }}><CopyOutlined aria-hidden="true" />复制归属信息</button>
            <span role="status">{copyStatus}</span>
          </div>
          <p className="ip-lookup-note">IP 归属反映数据库记录，不代表设备的精确位置，也不能单独证明网络故障。</p>
        </div>
      ) : null}
    </section>
  );
};

export default IpLookupPanel;
