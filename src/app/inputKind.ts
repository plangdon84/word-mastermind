/**
 * The focus ring only for keyboard use (issue 249). `:focus-visible` should
 * be enough, but iPhone Safari can still ring a button after a tap (Hard on
 * the Daily Word's difficulty choice, until anything else was tapped). So
 * the page notes how it was last used, on `<html data-input>`, and
 * styles.css hides the ring after a tap or click; a key brings it back.
 */
export function trackInputKind(doc: Document): void {
  const root = doc.documentElement;
  root.dataset.input = 'pointer';
  doc.addEventListener('pointerdown', () => {
    root.dataset.input = 'pointer';
  }, { capture: true, passive: true });
  doc.addEventListener('keydown', (event) => {
    // A modifier on its own (as in a screenshot) isn't using the page by keyboard.
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
    root.dataset.input = 'keyboard';
  }, { capture: true });
}
