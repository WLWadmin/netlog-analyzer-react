import { useEffect, useState } from 'react';
import { Button, Checkbox, Modal, message } from 'antd';
import { downloadTextFile } from '../../utils/downloadTextFile';

interface ExportPreviewJob {
  filename: string;
  mime: string;
  sharingText: string;
  buildExpertText?: () => string;
  expertFields?: string;
}

interface PreviewState {
  owner: unknown;
  job: ExportPreviewJob;
  text: string;
  expert: boolean;
  expertText?: string;
}

/** 一次生成的快照供预览、复制、下载共用；换数据后旧快照不可操作。 */
export function useExportPreview(owner: unknown) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  useEffect(() => setPreview(null), [owner]);
  const current = preview?.owner === owner ? preview : null;
  const openExportPreview = (job: ExportPreviewJob) => {
    setPreview({ owner, job, text: job.sharingText, expert: false });
  };
  const copy = async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.text);
      message.success('已复制预览内容');
    } catch {
      message.error('复制失败，请在预览中手动复制');
    }
  };
  const chooseExpert = (checked: boolean) => {
    if (!current) return;
    try {
      const expertText = checked
        ? current.expertText ?? current.job.buildExpertText?.()
        : current.expertText;
      setPreview({
        owner: current.owner, job: current.job, expert: checked, expertText,
        text: checked ? expertText ?? current.job.sharingText : current.job.sharingText,
      });
    } catch {
      message.error('专家导出生成失败，分享预览已保留');
    }
  };
  const exportPreview = current ? (
    <Modal title="导出预览" open onCancel={() => setPreview(null)} width={800} footer={[
      <Button key="cancel" onClick={() => setPreview(null)}>取消</Button>,
      <Button key="copy" onClick={copy}>复制内容</Button>,
      <Button key="download" type="primary" onClick={() => {
        downloadTextFile(current.job.filename, current.text, current.job.mime);
        message.success('文件已下载');
      }}>下载文件</Button>,
    ]}>
      <p>{current.expert
        ? '本地专家导出：包含下列原始字段，请仅交给获准接收这些信息的人。'
        : '默认分享：地址使用单报告别名，凭据、原始正文与开放配置不纳入分享。分享前请复核。'}</p>
      {current.job.buildExpertText ? (
        <Checkbox checked={current.expert} onChange={event => chooseExpert(event.target.checked)}>
          保留本地专家字段：{current.job.expertFields}
        </Checkbox>
      ) : null}
      <textarea aria-label="导出内容" readOnly value={current.text}
        style={{ width: '100%', height: 360, marginTop: 12, fontFamily: 'monospace',
          background: 'var(--bg-surface)', color: 'var(--text-primary)' }} />
    </Modal>
  ) : null;
  return { openExportPreview, exportPreview };
}
