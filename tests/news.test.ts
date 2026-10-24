import { readdirSync, statSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LANGS } from '../src/i18n';
import { NEWS } from '../src/news/items';
import { isReturningPlayer, markNewsSeen, MAX_SHOWN, newsForThisPlayer, NEWS_KEY, pendingNews } from '../src/news/news';
import type { NewsBundle } from '../src/news/types';
import { SETTINGS_KEY } from '../src/settings';

const bundle = (tag: string, ids: string[]): NewsBundle => ({
  tag,
  summary: { de: `Zusammenfassung ${tag}`, en: `Summary ${tag}` },
  items: ids.map((id) => ({ id, title: { de: id, en: id }, text: { de: id, en: id } })),
});
const bundles = [bundle('v1.4.0', ['d', 'c']), bundle('v1.3.0', ['b']), bundle('v1.2.0', ['a'])];

function storage(initial: Record<string, string> = {}): Map<string, string> {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  return values;
}

afterEach(() => vi.unstubAllGlobals());

describe('who gets told what', () => {
  it('shows whole release bundles newer than the last tag the player saw', () => {
    expect(pendingNews(bundles, 'v1.3.0', true).map((entry) => entry.tag)).toEqual(['v1.4.0']);
  });

  it('has nothing for somebody who is up to date', () => {
    expect(pendingNews(bundles, 'v1.4.0', true)).toEqual([]);
  });

  it('leaves a first-time visitor alone: there is nothing new to them', () => {
    expect(pendingNews(bundles, null, false)).toEqual([]);
  });

  it('gives a returning player who never saw the dialog the newest bundles', () => {
    expect(pendingNews(bundles, null, true)).toEqual(bundles);
  });

  it('limits old unread releases while keeping each selected release intact', () => {
    const many = Array.from({ length: MAX_SHOWN + 3 }, (_, i) => bundle(`v1.${MAX_SHOWN + 3 - i}.0`, [`n${i}-one`, `n${i}-two`]));
    const pending = pendingNews(many, null, true);
    expect(pending).toEqual(many.slice(0, MAX_SHOWN));
    expect(pending[0].items).toHaveLength(2);
  });

  it('copes with a release tag that has since been taken out of the list', () => {
    expect(pendingNews(bundles, 'v1.0.0', true)).toEqual(bundles);
  });
});

describe('remembering what was seen', () => {
  it('stores the newest release tag and then has nothing left to say', () => {
    const values = storage({ [SETTINGS_KEY]: '{}' });
    expect(newsForThisPlayer(isReturningPlayer(), bundles)).toEqual(bundles);
    markNewsSeen(bundles);
    expect(values.get(NEWS_KEY)).toBe('v1.4.0');
    expect(newsForThisPlayer(true, bundles)).toEqual([]);
  });

  it('announces a new tagged release to a returning player', () => {
    storage({ [SETTINGS_KEY]: '{}', [NEWS_KEY]: 'v1.4.0' });
    const newest = bundle('v1.5.0', ['e-one', 'e-two']);
    expect(newsForThisPlayer(true, [newest, ...bundles])).toEqual([newest]);
  });

  it('knows a browser without saved settings has not played yet', () => {
    storage();
    expect(isReturningPlayer()).toBe(false);
    storage({ [SETTINGS_KEY]: '{}' });
    expect(isReturningPlayer()).toBe(true);
  });

  it('survives blocked storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(isReturningPlayer()).toBe(false);
    expect(newsForThisPlayer(true, bundles)).toEqual([]);
    expect(() => markNewsSeen(bundles)).not.toThrow();
  });
});

describe('the announcements themselves', () => {
  it('have unique item ids', () => {
    const ids = NEWS.flatMap((entry) => entry.items.map((item) => item.id));
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('have summaries and item copy in every language', () => {
    for (const bundle of NEWS) {
      for (const lang of LANGS) expect(bundle.summary[lang].trim(), `${bundle.tag} summary ${lang}`).not.toBe('');
      for (const entry of bundle.items) {
        for (const lang of LANGS) {
          expect(entry.title[lang].trim(), `${entry.id} title ${lang}`).not.toBe('');
          expect(entry.text[lang].trim(), `${entry.id} text ${lang}`).not.toBe('');
          if (entry.where) expect(entry.where[lang].trim(), `${entry.id} where ${lang}`).not.toBe('');
          if (entry.image) expect(entry.image.alt[lang].trim(), `${entry.id} alt ${lang}`).not.toBe('');
        }
      }
    }
  });

  it('uses small .webp pictures', () => {
    for (const bundle of NEWS) {
      for (const entry of bundle.items) {
        if (entry.image) expect(entry.image.src, entry.id).toContain('.webp');
      }
    }
    const folder = new URL('../src/news/images/', import.meta.url);
    for (const file of readdirSync(folder)) expect(statSync(new URL(file, folder)).size, file).toBeLessThan(250 * 1024);
  });
});
