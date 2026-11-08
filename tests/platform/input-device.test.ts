import { afterEach, describe, expect, it } from 'vitest';
import { getLang, setLang } from '../../src/platform/i18n';
import { cap, hintText, lastInput, noteInput, padMode } from '../../src/platform/input-device';

describe('what was used last', () => {
  const lang = getLang();
  afterEach(() => {
    noteInput('keyboard');
    setLang(lang);
  });

  it('starts with the keyboard and remembers the last one that was used', () => {
    expect(lastInput()).toBe('keyboard');
    noteInput('pad');
    expect(lastInput()).toBe('pad');
    noteInput('pointer');
    expect(lastInput()).toBe('pointer');
  });

  it.each(['de', 'en'] as const)('words the key hints for the pad only after the pad was used (%s)', (language) => {
    setLang(language);
    for (const line of ['shell.keys', 'launcher.keys', 'flow.tabKeys', 'briefing.keys', 'title.keys', 'setup.keys', 'over.keys'] as const) {
      noteInput('keyboard');
      const keys = hintText(line);
      noteInput('pad');
      const pad = hintText(line);
      expect(pad).not.toBe(keys);
      expect(pad).toMatch(/D-Pad|D-pad/);
      expect(keys).not.toMatch(/D-Pad|D-pad/);
      noteInput('pointer');
      expect(hintText(line)).toBe(keys);
    }
  });

  it('says when the hints change between keys and buttons, and only then', () => {
    expect(noteInput('keyboard')).toBe(false);
    expect(noteInput('pad')).toBe(true);
    expect(noteInput('pad')).toBe(false);
    expect(padMode()).toBe(true);
    expect(noteInput('pointer')).toBe(true);
    expect(padMode()).toBe(false);
  });

  it('puts the controller\'s button on a keycap only while it was used last', () => {
    const caps = ['Q', 'E', 'Enter', 'Space', 'Leertaste', 'Esc', 'C', 'P', '← →', '↑ ↓'];
    noteInput('keyboard');
    for (const c of caps) expect(cap(c)).toBe(c);
    noteInput('pad');
    expect(caps.map(cap)).toEqual(['LB', 'RB', 'A', 'A', 'A', 'B', 'Back', 'X', 'L-Stick ← →', 'L-Stick ↑ ↓']);
    // What the pad has no button for stays as it is.
    expect(cap('F')).toBe('F');
  });

  it.each(['de', 'en'] as const)('has a pad twin for every hint that names a key (%s)', (language) => {
    setLang(language);
    for (const key of ['players.moveTarget', 'tutorial.welcome.3', 'tutorial.powerups.1', 'skip.confirm'] as const) {
      noteInput('keyboard');
      const keys = hintText(key, { name: 'X' });
      noteInput('pad');
      expect(hintText(key, { name: 'X' })).not.toBe(keys);
    }
  });
});
