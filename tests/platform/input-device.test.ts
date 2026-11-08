import { afterEach, describe, expect, it } from 'vitest';
import { getLang, setLang } from '../../src/platform/i18n';
import { keysLine, lastInput, noteInput } from '../../src/platform/input-device';

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
      const keys = keysLine(line);
      noteInput('pad');
      const pad = keysLine(line);
      expect(pad).not.toBe(keys);
      expect(pad).toMatch(/D-Pad|D-pad/);
      expect(keys).not.toMatch(/D-Pad|D-pad/);
      noteInput('pointer');
      expect(keysLine(line)).toBe(keys);
    }
  });
});
