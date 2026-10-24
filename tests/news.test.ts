import { readdirSync, statSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LANGS } from '../src/i18n';
import { NEWS } from '../src/news/items';
import { isReturningPlayer, markNewsSeen, MAX_SHOWN, newsForThisPlayer, NEWS_KEY, pendingNews } from '../src/news/news';
import type { NewsItem } from '../src/news/types';
import { SETTINGS_KEY } from '../src/settings';

const item = (id: string): NewsItem => ({ id, date: '2026-01-01', title: { de: id, en: id }, text: { de: id, en: id } });
const items = ['d', 'c', 'b', 'a'].map(item);

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
  it('tells a returning player everything above the last item they saw, newest first', () => {
    expect(pendingNews(items, 'b', true).map((i) => i.id)).toEqual(['d', 'c']);
  });

  it('has nothing for somebody who is up to date', () => {
    expect(pendingNews(items, 'd', true)).toEqual([]);
  });

  it('leaves a first-time visitor alone: there is nothing new to them', () => {
    expect(pendingNews(items, null, false)).toEqual([]);
  });

  it('gives a returning player who never saw the dialog the newest items', () => {
    expect(pendingNews(items, null, true).map((i) => i.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('shows no more than a handful at once, the newest', () => {
    const many = Array.from({ length: MAX_SHOWN + 3 }, (_, i) => item(`n${i}`));
    expect(pendingNews(many, null, true)).toEqual(many.slice(0, MAX_SHOWN));
  });

  it('copes with an item that has since been taken out of the list', () => {
    expect(pendingNews(items, 'gone', true)).toHaveLength(items.length);
  });
});

describe('remembering what was seen', () => {
  it('stores the newest id, and then has nothing left to say', () => {
    const values = storage({ [SETTINGS_KEY]: '{}' });
    expect(newsForThisPlayer(isReturningPlayer(), items)).toHaveLength(items.length);
    markNewsSeen(items);
    expect(values.get(NEWS_KEY)).toBe('d');
    expect(newsForThisPlayer(true, items)).toEqual([]);
  });

  it('announces a new item at the top again', () => {
    storage({ [SETTINGS_KEY]: '{}', [NEWS_KEY]: 'd' });
    expect(newsForThisPlayer(true, [item('e'), ...items]).map((i) => i.id)).toEqual(['e']);
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
    expect(newsForThisPlayer(true, items)).toEqual([]);
    expect(() => markNewsSeen(items)).not.toThrow();
  });
});

describe('the announcements themselves', () => {
  it('are there, with ids nobody has used before', () => {
    expect(NEWS.length).toBeGreaterThan(0);
    expect(new Set(NEWS.map((i) => i.id)).size).toBe(NEWS.length);
  });

  it('are dated, newest first', () => {
    for (const { id, date } of NEWS) expect(date, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const dates = NEWS.map((i) => i.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('are written in every language', () => {
    for (const entry of NEWS) {
      for (const lang of LANGS) {
        expect(entry.title[lang].trim(), `${entry.id} title ${lang}`).not.toBe('');
        expect(entry.text[lang].trim(), `${entry.id} text ${lang}`).not.toBe('');
        if (entry.where) expect(entry.where[lang].trim(), `${entry.id} where ${lang}`).not.toBe('');
        if (entry.image) expect(entry.image.alt[lang].trim(), `${entry.id} alt ${lang}`).not.toBe('');
      }
    }
  });

  it('come with .webp pictures small enough to ship', () => {
    for (const entry of NEWS) {
      if (entry.image) expect(entry.image.src, entry.id).toMatch(/\.webp(\?.*)?$/);
    }
    const folder = new URL('../src/news/images/', import.meta.url);
    for (const file of readdirSync(folder)) expect(statSync(new URL(file, folder)).size, file).toBeLessThan(250 * 1024);
  });
});
