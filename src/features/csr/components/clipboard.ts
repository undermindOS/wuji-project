/** Puts a table on the clipboard as HTML and as plain text. Returns false when the browser refuses both ways. */
export async function copyTable(html: string, text: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('no async clipboard');
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    return true;
  } catch {
    // Where the async clipboard is not allowed, copy a rendered copy of the table the old way.
    const holder = document.createElement('div');
    holder.innerHTML = html;
    holder.style.cssText = 'position:fixed;left:-9999px;top:0;color:#000;background:#fff';
    document.body.appendChild(holder);
    const selection = window.getSelection(), range = document.createRange();
    range.selectNodeContents(holder); selection?.removeAllRanges(); selection?.addRange(range);
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    selection?.removeAllRanges(); holder.remove();
    return copied;
  }
}

export const escapeHtml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
