import { describe, expect, it } from 'vitest';
import { DEV_PAGES } from '../dev/pages';
import { devRoute } from '../dev/routes';

describe('development page access', () => {
  it('excludes every tool, its source namespace and its legacy route from production preview', () => {
    for (const page of DEV_PAGES) {
      expect(devRoute(page.path, false, true)?.status).toBe(404);
      if ('legacy' in page) expect(devRoute(page.legacy, false, true)?.status).toBe(404);
    }
    for (const path of ['/dev', '/dev/index.html', '/dev/pages.ts', '/dev/missing.html']) expect(devRoute(path, false, false)?.status).toBe(404);
    expect(devRoute('/', false, false)).toBeNull();
    expect(devRoute('/stats', false, false)).toBeNull();
  });

  it('preserves seed, aim and language parameters through legacy redirects', () => {
    for (const page of DEV_PAGES) {
      if ('legacy' in page) expect(devRoute(page.legacy + '?seed=31&angle=72&lang=en', true, true)).toEqual({ status: 307, location: page.path + '?seed=31&angle=72&lang=en' });
      expect(devRoute(page.path, true, true)).toBeNull();
    }
    expect(devRoute('/dev?lang=de', true, false)).toEqual({ status: 307, location: '/dev/?lang=de' });
    expect(devRoute('/dev/index.html', true, false)).toBeNull();
  });

  it('keeps the aim predictor behind DEBUG_AIM on both routes', () => {
    for (const path of ['/dev/aim.html?seed=31', '/debug-aim.html?seed=31']) expect(devRoute(path, true, false)?.status).toBe(404);
    expect(devRoute('/dev/aim.html?seed=31', true, true)).toBeNull();
    expect(devRoute('/dev/looks.html', true, false)).toBeNull();
  });

  it('returns 404 for unknown dev pages instead of opening the game', () => {
    expect(devRoute('/dev/missing.html', true, true)?.status).toBe(404);
    expect(devRoute('/dev/missing', true, true)?.status).toBe(404);
    expect(devRoute('/dev/pages.ts', true, true)).toBeNull();
  });

  it('registers the daily challenge gallery in DEV_PAGES', () => {
    const daily = DEV_PAGES.find((p) => p.id === 'daily');
    expect(daily).toBeDefined();
    expect(daily?.path).toBe('/dev/daily.html');
  });
});
