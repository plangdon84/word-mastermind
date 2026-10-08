/*
 * Made-up Daily Rush sets for tests, the browser tests, the load test and a
 * local server (`npm run daily-themes -- local --test`). They're not real
 * themes: no two of their words share a theme in the private calendar, so
 * they give nothing away. No imports, so Node can run it as is.
 */

export const TEST_THEMES = [
  { id: 'test-a', theme: 'Test set A', words: ['brick', 'jumpy', 'solve', 'night'] },
  { id: 'test-b', theme: 'Test set B', words: ['guild', 'fight', 'vowel', 'dusty'] },
  { id: 'test-c', theme: 'Test set C', words: ['quart', 'blend', 'smoky', 'wafer'] },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const daysSinceEpoch = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

/** The test set for a UTC day: the three take turns. */
export function testThemeFor(day: string) {
  return TEST_THEMES[((daysSinceEpoch(day) % TEST_THEMES.length) + TEST_THEMES.length) % TEST_THEMES.length];
}

/** `count` days from `from`, each with its test set, as `npm run daily-themes` loads them. */
export function testThemeDays(from: string, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const day = dayOf(Date.parse(`${from}T00:00:00Z`) + i * DAY_MS);
    const { id, theme, words } = testThemeFor(day);
    return { day, id, theme, words: [...words] };
  });
}
