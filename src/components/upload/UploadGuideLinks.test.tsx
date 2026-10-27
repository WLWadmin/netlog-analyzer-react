import { render, screen } from '@testing-library/react';
import UploadGuideLinks from './UploadGuideLinks';

it('pairs the original format explanations with five acquisition guides in one grid', () => {
  const { container } = render(<UploadGuideLinks />);
  expect(screen.getByRole('heading', { name: '不同文件主要能回答什么？' })).not.toBeNull();
  expect(screen.getByText('连接为什么没有建立？')).not.toBeNull();
  expect(screen.getByText('哪些页面请求失败或变慢？')).not.toBeNull();
  expect(screen.getByText('应用当时发生了什么？')).not.toBeNull();
  expect(container.querySelectorAll('.upload-capability-grid > article')).toHaveLength(5);
  expect(screen.getAllByRole('link')).toHaveLength(5);
  expect(screen.getByRole('link', { name: 'Trace 获取指南' }).getAttribute('href'))
    .toBe('https://bytedance.larkoffice.com/docx/doxcnOUCJvHuGOVvdUbnXFQR4sd');
  const wireshark = screen.getByRole('link', { name: 'Wireshark 获取指南' });
  expect(wireshark.getAttribute('href'))
    .toBe('https://bytedance.larkoffice.com/docx/FOkgd68wLoJphWxUusecTEDTnFc');
  expect(wireshark.closest('article')?.textContent).toContain('仅采集指南 · 不支持导入');
  screen.getAllByRole('link').forEach(link => {
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
