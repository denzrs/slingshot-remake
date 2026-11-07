import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/data/settings';
import { dailyChallenge } from '../../src/sim/challenge';
import { createChallenge } from '../../src/game';
import { dailyResultScreen } from '../../src/ui/daily/daily';
import type { App } from '../../src/ui/screens';

class FakeElement {
  className = '';
  children: FakeElement[] = [];
  childNodes: (FakeElement | string)[] = [];
  attributes: Record<string, string> = {};

  constructor(readonly tagName: string) {}

  get classList() {
    return {
      contains: (c: string) => this.className.split(' ').includes(c),
    };
  }

  setAttribute(k: string, v: string) {
    this.attributes[k] = v;
  }

  append(...nodes: (FakeElement | string)[]) {
    for (const node of nodes) {
      if (node === null || node === undefined) continue;
      this.childNodes.push(node);
      if (typeof node !== 'string') this.children.push(node);
    }
  }

  replaceChildren(...nodes: (FakeElement | string)[]) {
    this.childNodes = [];
    this.children = [];
    this.append(...nodes);
  }

  querySelectorAll(sel: string): FakeElement[] {
    const out: FakeElement[] = [];
    const check = (el: FakeElement) => {
      const cls = sel.replace(/^\./, '');
      if (sel.startsWith('.') && el.classList.contains(cls)) out.push(el);
      else if (el.tagName.toLowerCase() === sel.toLowerCase()) out.push(el);
      for (const child of el.children) check(child);
    };
    for (const child of this.children) check(child);
    return out;
  }

  querySelector(sel: string): FakeElement | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}

describe('dailyResultScreen', () => {
  beforeEach(() => {
    globalThis.document = {
      createElement: (tag: string) => new FakeElement(tag),
      createTextNode: (txt: string) => txt,
    } as unknown as Document;
  });

  it('shows anomaly badges and modifier tags on sector cards', () => {
    const ch = dailyChallenge('2026-11-08'); // Pinball Course: sector 0 clean, sectors 1-4 have pinball
    const m = createChallenge(DEFAULT_SETTINGS, ch);
    for (let i = 0; i < 5; i++) {
      m.results.push({
        index: i,
        targets: 2,
        budget: 4,
        cleared: true,
        shots: [],
        points: 500,
        bonus: 200,
      });
    }
    const mockApp = {
      today: () => '2026-11-08',
      toTitle: () => {},
      rematch: () => {},
      menu: { push: () => {}, back: () => {} },
    } as unknown as App;

    const screen = dailyResultScreen(mockApp, m, {
      record: { best: 2110, attempts: 1 },
      streak: 1,
      newBest: true,
    });

    const root = screen.build() as unknown as FakeElement;
    const cards = root.querySelectorAll('li');
    expect(cards).toHaveLength(5);

    // Sector 0 (Sector 1): Clean, no anomaly, no modifiers
    expect(cards[0].querySelector('.sectors__flag')).toBeNull();
    expect(cards[0].querySelector('.sectors__mods')).toBeNull();

    // Sector 1 (Sector 2): Pinball anomaly
    const flag1 = cards[1].querySelector('.sectors__flag');
    expect(flag1).not.toBeNull();
    const tags1 = cards[1].querySelectorAll('.sectors__tag');
    expect(tags1.length).toBeGreaterThan(0);
    expect(tags1.some((t) => t.classList.contains('sectors__tag--anomaly'))).toBe(true);

    // Sector 2 (Sector 3): Pinball + Bounce
    const flag2 = cards[2].querySelector('.sectors__flag');
    expect(flag2).not.toBeNull();
    const tags2 = cards[2].querySelectorAll('.sectors__tag');
    expect(tags2.length).toBeGreaterThanOrEqual(2);
    expect(tags2.some((t) => t.classList.contains('sectors__tag--anomaly'))).toBe(true);
  });
});
