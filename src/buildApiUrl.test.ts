import { describe, expect, it } from 'vitest';
import { buildApiUrl, STAGING_API_URL } from './buildApiUrl';

const PRODUCTION = 'https://word-mastermind-api.someone.workers.dev';
const STAGING = 'https://word-mastermind-api-staging.someone.workers.dev';
const both = { VITE_API_URL: PRODUCTION, VITE_API_URL_PREVIEW: STAGING };

describe('buildApiUrl', () => {
  it('leaves main, local builds and the dev server on VITE_API_URL', () => {
    expect(buildApiUrl('production', { ...both, CF_PAGES_BRANCH: 'main' })).toBeUndefined();
    expect(buildApiUrl('production', both)).toBeUndefined();
    expect(buildApiUrl('development', { ...both, CF_PAGES_BRANCH: 'feature' })).toBeUndefined();
  });

  it('gives a preview the staging worker, never VITE_API_URL', () => {
    expect(buildApiUrl('production', { ...both, CF_PAGES_BRANCH: 'feature' })).toBe(STAGING);
  });

  it('gives a preview the staging worker without any setting', () => {
    expect(buildApiUrl('production', { VITE_API_URL: PRODUCTION, CF_PAGES_BRANCH: 'feature' })).toBe(STAGING_API_URL);
    expect(buildApiUrl('production', { VITE_API_URL: PRODUCTION, VITE_API_URL_PREVIEW: ' ', CF_PAGES_BRANCH: 'feature' }))
      .toBe(STAGING_API_URL);
  });

  it('builds a preview without a server when the setting is not an address, or production', () => {
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    expect(buildApiUrl('production', { VITE_API_URL_PREVIEW: 'staging', CF_PAGES_BRANCH: 'feature' }, warn)).toBe('');
    expect(buildApiUrl('production', { VITE_API_URL_PREVIEW: PRODUCTION, CF_PAGES_BRANCH: 'feature' }, warn)).toBe('');
    expect(buildApiUrl('production', { VITE_API_URL_PREVIEW: 'https://api.wordmastermind.app', CF_PAGES_BRANCH: 'feature' }, warn))
      .toBe('');
    expect(warnings).toHaveLength(3);
  });
});
