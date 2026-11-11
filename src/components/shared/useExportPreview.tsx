import { useEffect, useRef, useState } from 'react';
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

// 这是 DOM 预览预算，不是导出大小上限；UTF-16 边界避开半个代理对。
const PREVIEW_CHAR_LIMIT = 32768;

/** 一次生成的快照供预览、复制、下载共用；换数据后旧快照不可操作。 */
export function useExportPreview(owner: unknown) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const activeOwner = useRef(owner);
  const activePreview = useRef<PreviewState | null>(null);
  activeOwner.current = owner;
  useEffect(() => {
    activePreview.current = null;
    setPreview(null);
  }, [owner]);
  const current = preview?.owner === owner ? preview : null;
  const close = () => {
    activePreview.current = null;
    setPreview(null);
  };
  const openExportPreview = (job: ExportPreviewJob) => {
    if (activeOwner.current !== owner) return;
    // 字符串本身不可变；复制 job 元数据避免调用方随后改写下载名或生成器。
    const next: PreviewState = { owner, job: {
      filename: job.filename, mime: job.mime, sharingText: job.sharingText,
      buildExpertText: job.buildExpertText, expertFields: job.expertFields,
    }, text: job.sharingText, expert: false };
    activePreview.current = next;
    setPreview(next);
  };
  const copy = async () => {
    if (!current || activeOwner.current !== current.owner || activePreview.current !== current) return;
    try {
      await navigator.clipboard.writeText(current.text);
      message.success('已复制完整导出内容');
    } catch {
      message.error('复制失败，请下载完整文件；预览可能仅显示部分内容');
    }
  };
  const chooseExpert = (checked: boolean) => {
    if (!current || activeOwner.current !== current.owner || activePreview.current !== current) return;
    try {
      const expertText = checked
        ? current.expertText ?? current.job.buildExpertText?.()
        : current.expertText;
      const next = {
        owner: current.owner, job: current.job, expert: checked, expertText,
        text: checked ? expertText ?? current.job.sharingText : current.job.sharingText,
      };
      activePreview.current = next;
      setPreview(next);
    } catch {
      message.error('专家导出生成失败，分享预览已保留');
    }
  };
  let previewEnd = Math.min(current?.text.length ?? 0, PREVIEW_CHAR_LIMIT);
  if (current && previewEnd < current.text.length
    && /[\uD800-\uDBFF]/.test(current.text[previewEnd - 1])) previewEnd -= 1;
  const previewText = current?.text.slice(0, previewEnd) ?? '';
  const partial = Boolean(current && previewEnd < current.text.length);
  const exportPreview = current ? (
    <Modal title="导出预览" open onCancel={close} width={800} footer={[
      <Button key="cancel" onClick={close}>取消</Button>,
      <Button key="copy" onClick={copy}>复制内容</Button>,
      <Button key="download" type="primary" onClick={() => {
        if (activeOwner.current !== current.owner || activePreview.current !== current) return;
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
      {partial ? <p role="status">预览仅显示部分内容；复制和下载保留完整导出内容。</p> : null}
      <textarea aria-label="导出内容" readOnly value={previewText}
        style={{ width: '100%', height: 360, marginTop: 12, fontFamily: 'monospace',
          background: 'var(--bg-surface)', color: 'var(--text-primary)' }} />
    </Modal>
  ) : null;
  return { openExportPreview, exportPreview };
}
