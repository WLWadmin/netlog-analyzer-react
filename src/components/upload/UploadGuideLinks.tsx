import {
  CloudUploadOutlined,
  CodeOutlined,
  FileTextOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';

const guides = [
  {
    title: 'HAR 获取指南',
    description: '从 DevTools Network 导出页面请求记录',
    href: 'https://bytedance.larkoffice.com/wiki/NbIuwtlAKi0C1nk2SkdcLcjTnDb',
    icon: <FileTextOutlined />,
  },
  {
    title: 'NetLog 获取指南',
    description: '从浏览器 net-export 页面导出网络栈记录',
    href: 'https://bytedance.larkoffice.com/docx/NfwtdMpCLoh04yx0xnec1PXCnnf',
    icon: <CloudUploadOutlined />,
  },
  {
    title: 'Go Log 获取指南',
    description: '导出服务标准输出或结构化日志文件',
    href: 'https://bytedance.larkoffice.com/wiki/O6UJwfl0UivPlBk7pCHcrzxfnJd',
    icon: <CodeOutlined />,
  },
];

const UploadGuideLinks: React.FC = () => (
  <section className="upload-guide" aria-labelledby="upload-guide-title">
    <div className="upload-guide-heading">
      <QuestionCircleOutlined aria-hidden="true" />
      <div>
        <strong id="upload-guide-title">文件获取</strong>
        <span>需要重新采集时查看对应说明</span>
      </div>
    </div>
    <div className="upload-guide-grid">
      {guides.map(guide => (
        <a key={guide.title} href={guide.href} target="_blank" rel="noopener noreferrer">
          <span className="upload-guide-icon" aria-hidden="true">{guide.icon}</span>
          <span>
            <strong>{guide.title}</strong>
            <small>{guide.description}</small>
          </span>
        </a>
      ))}
    </div>
  </section>
);

export default UploadGuideLinks;
