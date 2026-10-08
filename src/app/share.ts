/**
 * Opens the system share sheet. On iPhone, turning the phone while the sheet
 * is open and then closing it could leave a blank page until you scrolled
 * (manual checklist finding 5), so once the sheet closes the page is nudged
 * by a pixel and back over two frames, and the screen given a layer of its
 * own for a frame (for screens that don't scroll), which makes Safari redraw
 * it to fit the new layout. Closing the sheet without sending rejects; that's fine.
 */
export function shareLink(data: ShareData): void {
  if (!navigator.share) return;
  void navigator.share(data).catch(() => {}).then(redraw);
}

function redraw(): void {
  const page = document.scrollingElement;
  if (!page) return;
  const screen = document.querySelector<HTMLElement>('.app');
  const y = Math.max(0, Math.min(page.scrollTop, page.scrollHeight - page.clientHeight));
  requestAnimationFrame(() => {
    page.scrollTop = y > 0 ? y - 1 : y + 1;
    if (screen) screen.style.transform = 'translateZ(0)';
    requestAnimationFrame(() => {
      page.scrollTop = y;
      if (screen) screen.style.transform = '';
    });
  });
}
