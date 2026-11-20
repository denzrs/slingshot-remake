import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanTemplateName, deleteTemplate, loadTemplates, MAX_TEMPLATE_FILE_BYTES, MAX_TEMPLATE_NAME, MAX_TEMPLATES, parseTemplateFile,
  saveTemplate, TEMPLATE_FORMAT, TEMPLATE_VERSION, templateFile, templateFileName, templateFrom, type TournamentTemplate,
} from '../../src/data/tournamentTemplates';
import { defaultRoomRules } from '../../src/data/roomRules';

const KEY = 'slingshot.tournamentTemplates.v1';

const storage = (initial: Record<string, string> = {}) => {
  const values = { ...initial };
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => void (values[key] = value),
  });
  return values;
};

afterEach(() => vi.unstubAllGlobals());

const stages = () => [5, 3, 3, 3].map((rounds) => ({ gameMode: 'classic' as const, rules: { ...defaultRoomRules(), rounds } }));
const template = (extra: Record<string, unknown> = {}) => ({ format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION, name: 'Freitag', teamSize: 2, stages: stages(), ...extra });
const withStage = (index: number, stage: unknown) => template({ stages: stages().map((s, i) => (i === index ? stage : s)) });
const withRule = (key: string, value: unknown) => withStage(1, { gameMode: 'classic', rules: { ...defaultRoomRules(), [key]: value } });
const error = (value: unknown) => {
  const result = templateFrom(value);
  return result.ok ? null : result.error;
};

describe('a template file', () => {
  it('goes there and back unchanged', () => {
    const original = { name: 'Freitag', teamSize: 2, stages: stages() };
    const result = parseTemplateFile(templateFile(original));
    expect(result).toEqual({ ok: true, template: original });
  });

  it('takes rules left out as the standard ones', () => {
    const result = templateFrom(template({ stages: stages().map((s) => ({ gameMode: s.gameMode, rules: { rounds: 3 } })) }));
    expect(result.ok && result.template.stages[0].rules).toEqual({ ...defaultRoomRules(), rounds: 3 });
  });

  it('refuses what is not JSON, not a template, or too big', () => {
    expect(parseTemplateFile('{nope')).toEqual({ ok: false, error: 'notJson' });
    expect(parseTemplateFile('[]')).toEqual({ ok: false, error: 'notTemplate' });
    expect(parseTemplateFile('null')).toEqual({ ok: false, error: 'notTemplate' });
    expect(parseTemplateFile(JSON.stringify({ ...template(), format: 'other' }))).toEqual({ ok: false, error: 'notTemplate' });
    expect(parseTemplateFile(' '.repeat(MAX_TEMPLATE_FILE_BYTES + 1))).toEqual({ ok: false, error: 'tooBig' });
    expect(error(template({ version: 2 }))).toBe('version');
  });

  it('refuses a wrong team size or number of levels', () => {
    for (const teamSize of [0, 4, 1.5, '2', null, -1]) expect(error(template({ teamSize }))).toBe('teamSize');
    expect(error(template({ stages: stages().slice(0, 3) }))).toBe('stages');
    expect(error(template({ stages: [...stages(), stages()[0]] }))).toBe('stages');
    expect(error(template({ stages: {} }))).toBe('stages');
    expect(error(withStage(2, 'classic'))).toBe('stages');
  });

  it('refuses an unknown mode', () => {
    expect(error(withStage(0, { gameMode: '<img src=x onerror=alert(1)>', rules: {} }))).toBe('mode');
    expect(error(withStage(0, { gameMode: 'constructor', rules: {} }))).toBe('mode');
  });

  it('refuses any rule the game does not have, or a value it does not allow', () => {
    expect(error(withRule('evil', true))).toBe('rules');
    expect(error(withRule('__proto__', { polluted: true }))).toBe('rules');
    expect(error(withRule('rounds', 0))).toBe('rules');
    expect(error(withRule('rounds', 1000))).toBe('rules');
    expect(error(withRule('rounds', '3'))).toBe('rules');
    expect(error(withRule('edges', '<script>'))).toBe('rules');
    expect(error(withRule('powerUpKinds', ['nope']))).toBe('rules');
    expect(error(withRule('powerUpKinds', 'shield'))).toBe('rules');
    expect(error(withRule('anomalies', [1, 2]))).toBe('rules');
    expect(error(withStage(0, { gameMode: 'classic', rules: [] }))).toBe('rules');
    expect(error(withStage(0, { gameMode: 'classic', rules: null }))).toBe('rules');
  });

  it('does not let a parsed __proto__ key reach the prototype', () => {
    const text = JSON.stringify(template()).replace('"name"', '"__proto__":{"polluted":true},"name"');
    expect(parseTemplateFile(text).ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const rules = text.replace('"rounds":5', '"__proto__":{"polluted":true},"rounds":5');
    expect(parseTemplateFile(rules)).toEqual({ ok: false, error: 'rules' });
  });

  it('keeps nothing of the file beyond the settings', () => {
    const result = templateFrom(template({ id: 'x', extra: '<b>' }));
    expect(result.ok && Object.keys(result.template)).toEqual(['name', 'teamSize', 'stages']);
  });
});

describe('a template name', () => {
  it('loses control and invisible characters and is cut to length', () => {
    expect(cleanTemplateName('  Cup\u0000‮​  am\n\tFreitag  ')).toBe('Cup am Freitag');
    expect(cleanTemplateName('x'.repeat(100))).toHaveLength(MAX_TEMPLATE_NAME);
    expect(error(template({ name: '​ \u0007' }))).toBe('name');
    expect(error(template({ name: 42 }))).toBe('name');
  });

  it('stays the text it is: markup is not taken out but never treated as markup', () => {
    const result = templateFrom(template({ name: '<img src=x onerror=alert(1)>' }));
    expect(result.ok && result.template.name).toBe('<img src=x onerror=alert(1)>');
  });

  it('gives a plain file name', () => {
    expect(templateFileName('Überraschungs-Cup <script>')).toBe('uberraschungs-cup-script.slingshot-tournament.json');
    expect(templateFileName('../../etc/passwd')).toBe('etc-passwd.slingshot-tournament.json');
    expect(templateFileName('⚡')).toBe('tournament.slingshot-tournament.json');
  });
});

describe('templates kept in the browser', () => {
  it('start empty, and survive a broken or blocked storage', () => {
    storage();
    expect(loadTemplates()).toEqual([]);
    storage({ [KEY]: '{broken' });
    expect(loadTemplates()).toEqual([]);
    storage({ [KEY]: '{"a":1}' });
    expect(loadTemplates()).toEqual([]);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(loadTemplates()).toEqual([]);
    expect(saveTemplate({ name: 'A', teamSize: 1, stages: stages() })).toBeNull();
  });

  it('are saved newest first, replaced by name, and deleted', () => {
    storage();
    const a = saveTemplate({ name: 'Alpha', teamSize: 1, stages: stages() })!;
    const b = saveTemplate({ name: 'Beta', teamSize: 3, stages: stages() })!;
    expect(loadTemplates().map((t) => t.name)).toEqual(['Beta', 'Alpha']);
    saveTemplate({ name: 'alpha', teamSize: 2, stages: stages() });
    expect(loadTemplates().map((t) => [t.name, t.teamSize])).toEqual([['alpha', 2], ['Beta', 3]]);
    deleteTemplate(b.id);
    expect(loadTemplates().map((t) => t.name)).toEqual(['alpha']);
    expect(a.id).toMatch(/^[a-z0-9]+$/);
  });

  it('stop at the limit, the oldest going', () => {
    storage();
    for (let i = 0; i < MAX_TEMPLATES + 3; i++) saveTemplate({ name: `T${i}`, teamSize: 1, stages: stages() });
    const names = loadTemplates().map((t) => t.name);
    expect(names).toHaveLength(MAX_TEMPLATES);
    expect(names[0]).toBe(`T${MAX_TEMPLATES + 2}`);
  });

  it('refuse to save what does not pass the checks', () => {
    storage();
    expect(saveTemplate({ name: '', teamSize: 1, stages: stages() })).toBeNull();
    expect(saveTemplate({ name: 'A', teamSize: 9, stages: stages() })).toBeNull();
  });

  it('leave out a tampered entry and keep the rest', () => {
    const good: TournamentTemplate = { id: 'abc', name: 'Gut', teamSize: 1, stages: stages() };
    storage({ [KEY]: JSON.stringify([
      { ...good, id: '"><script>' },
      { ...good, id: 'def', stages: [{ gameMode: 'classic', rules: { rounds: 'x' } }] },
      good,
      { ...good, name: 'Dup' },
    ]) });
    expect(loadTemplates()).toEqual([good]);
  });
});
