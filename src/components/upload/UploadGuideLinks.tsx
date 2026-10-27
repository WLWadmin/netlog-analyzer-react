const guides = [
  {
    code: 'NETLOG',
    question: '连接为什么没有建立？',
    scope: '代理、DNS、Socket、TLS 与协议',
    title: 'NetLog 获取指南',
    href: 'https://bytedance.larkoffice.com/docx/NfwtdMpCLoh04yx0xnec1PXCnnf',
  },
  {
    code: 'HAR',
    question: '哪些页面请求失败或变慢？',
    scope: '请求、响应、状态码与 Timing',
    title: 'HAR 获取指南',
    href: 'https://bytedance.larkoffice.com/wiki/NbIuwtlAKi0C1nk2SkdcLcjTnDb',
  },
  {
    code: 'TRACE',
    question: '页面为什么卡顿？',
    scope: '主线程、渲染、长任务与交互',
    title: 'Trace 获取指南',
    documentTitle: '【用户操作】获取Performance Profile',
    href: 'https://bytedance.larkoffice.com/docx/doxcnOUCJvHuGOVvdUbnXFQR4sd',
  },
  {
    code: 'LOG',
    question: '应用当时发生了什么？',
    scope: '业务流程、结果与服务端上下文',
    title: 'Go Log 获取指南',
    href: 'https://bytedance.larkoffice.com/wiki/O6UJwfl0UivPlBk7pCHcrzxfnJd',
  },
  {
    code: 'WIRESHARK',
    question: '仅采集指南 · 不支持导入',
    scope: '',
    title: 'Wireshark 获取指南',
    documentTitle: 'Wireshark 网络抓包；当前分析器不支持导入 .pcap / .pcapng',
    href: 'https://bytedance.larkoffice.com/docx/FOkgd68wLoJphWxUusecTEDTnFc',
  },
];

const UploadGuideLinks: React.FC = () => (
  <section className="upload-capability-map" aria-labelledby="upload-capability-title">
    <div className="upload-capability-heading">
      <h2 id="upload-capability-title">不同文件主要能回答什么？</h2>
      <span>文件获取 · 需要重新采集时查看对应说明</span>
    </div>
    <div className="upload-capability-grid">
      {guides.map(guide => (
        <article key={guide.code}>
          <code>{guide.code}</code>
          <strong>{guide.question}</strong>
          {guide.scope ? <span>{guide.scope}</span> : null}
          <a href={guide.href} title={guide.documentTitle} target="_blank" rel="noopener noreferrer">
            {guide.title} <span aria-hidden="true">↗</span>
          </a>
        </article>
      ))}
    </div>
  </section>
);

export default UploadGuideLinks;
