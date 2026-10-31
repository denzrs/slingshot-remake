import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOOKS, lookLabelKey } from '../../src/data/look';
import { getLang, setLang, t } from '../../src/platform/i18n';
import { painterFor } from '../../src/render/looks';
import { classic } from '../../src/render/looks/classic';

const render = fileURLToPath(new URL('../../src/render', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'looks' ? [] : sources(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

describe('looks', () => {
  it('has a painter for every look that answers to its own name', () => {
    for (const look of LOOKS) expect(painterFor(look).id).toBe(look);
  });

  it('draws every element in every look: a look builds on the engraved plan, so none is left out', () => {
    const elements = Object.keys(classic).sort();
    for (const look of LOOKS) expect(Object.keys(painterFor(look)).sort()).toEqual(elements);
  });

  it('keeps the look out of the renderer: only `render/looks/` knows which look is which', () => {
    // A branch on the look's name outside the look's own file is how a feature spreads over dozens of classes.
    const names = LOOKS.filter((look) => look !== 'classic').map((look) => `'${look}'`);
    const bad: string[] = [];
    for (const file of sources(render)) {
      const text = readFileSync(file, 'utf8');
      for (const name of names) if (text.includes(name)) bad.push(`${relative(render, file)} mentions ${name}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('registering a look', () => {
  it('gives every look a note for the gallery', () => {
    for (const look of LOOKS) expect(painterFor(look).note.length).toBeGreaterThan(10);
  });

  it('names every look in the settings in both languages', () => {
    const language = getLang();
    for (const look of LOOKS) {
      for (const lang of ['en', 'de'] as const) {
        setLang(lang);
        expect(t(lookLabelKey(look)), `${look} in ${lang}`).not.toBe(lookLabelKey(look));
      }
    }
    setLang(language);
  });
});
