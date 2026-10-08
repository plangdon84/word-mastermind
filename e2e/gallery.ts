import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * After the browser tests (globalTeardown in playwright.config.ts): an index
 * page for the screenshots screens.spec.ts saved, one row per screen with
 * every size across, to look through by eye. CI keeps e2e-gallery/ only when
 * a test fails (issue #168).
 */

const GALLERY = join(import.meta.dirname, '..', 'e2e-gallery');
const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);
const list = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : []);

export default function writeGallery(): void {
  if (!existsSync(GALLERY)) return;
  const browsers = list(GALLERY).filter((name) => !name.includes('.'));
  const sections = browsers.map((browser) => {
    const sizes = list(join(GALLERY, browser));
    const screens = [...new Set(sizes.flatMap((size) => list(join(GALLERY, browser, size))))];
    const rows = screens.map((shot) => {
      const cells = sizes.map((size) => {
        const src = `${browser}/${size}/${shot}`;
        return existsSync(join(GALLERY, src))
          ? `<figure><a href="${src}"><img loading="lazy" src="${src}" alt=""></a><figcaption>${size}</figcaption></figure>`
          : '';
      });
      return `<h3>${escape(shot.replace(/\.jpg$/, ''))}</h3><div class="row">${cells.join('')}</div>`;
    });
    return `<h2>${escape(browser)}</h2>${rows.join('')}`;
  });

  writeFileSync(join(GALLERY, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Word Mastermind screens</title>
<style>body{font:14px system-ui;margin:16px}.row{display:flex;gap:12px;overflow-x:auto;align-items:flex-start}
figure{margin:0}img{width:180px;border:1px solid #ccc}figcaption{color:#555}</style>
<h1>Every screen at every size</h1>
<p>Saved by the browser tests (docs/test-plan.md "Responsive layouts"). Tap a picture for full size.</p>
${sections.join('\n')}
`);
}
