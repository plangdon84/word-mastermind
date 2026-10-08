import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The keyboard's key states must be told apart (manual checklist finding 15):
 * in light mode an "out" key and a plain one were 1.4:1. WCAG asks 3:1
 * between states that matter, and 4.5:1 for each key's letter.
 */

const css = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');
const light = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));

function token(name: string): string {
  const value = light.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
  if (!value) throw new Error(`--${name} isn't set in light mode`);
  const ref = value.match(/^var\(--([\w-]+)\)$/);
  return ref ? token(ref[1]) : value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('keyboard colours in light mode', () => {
  it('draws a plain key like an unmarked bubble, white on black (issue #172)', () => {
    expect(token('key-plain')).toBe(token('unmarked-bg'));
    expect(token('key-fg')).toBe(token('unmarked-fg'));
    expect(token('key-out')).toBe(token('out-bg'));
  });

  it('tells an out key from a plain key, and an in key from a plain key', () => {
    expect(contrast(token('key-out'), token('key-plain'))).toBeGreaterThanOrEqual(3);
    expect(contrast(token('in-bg'), token('key-plain'))).toBeGreaterThanOrEqual(3);
    // A ready Enter key is drawn in the accent colour.
    expect(contrast(token('accent'), token('key-plain'))).toBeGreaterThanOrEqual(3);
  });

  it("keeps each key's letter readable", () => {
    expect(contrast(token('key-fg'), token('key-plain'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('out-fg'), token('key-out'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('in-fg'), token('in-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('bg'), token('accent'))).toBeGreaterThanOrEqual(4.5);
  });
});
