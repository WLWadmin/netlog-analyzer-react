export async function copyText(text: string): Promise<void> {
  if (!text) return;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy fallback below. Some browsers expose
      // navigator.clipboard but reject it outside secure contexts or WebViews.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);

  const selection = document.getSelection();
  const selectedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  try {
    textarea.focus();
    textarea.select();
    const copied = document.execCommand('copy');
    if (!copied) {
      throw new Error('execCommand copy returned false');
    }
  } finally {
    document.body.removeChild(textarea);
    if (selection && selectedRange) {
      selection.removeAllRanges();
      selection.addRange(selectedRange);
    }
  }
}
