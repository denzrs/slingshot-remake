import { isGameMode, type GameMode } from '../sim/modes';
import { isLegal, RULE_KEYS, roomRulesFrom, specOf, type RoomRules } from './roomRules';

/**
 * A tournament's general settings, kept to make the next one alike: the team size and what each level of the bracket plays.
 * Kept in this browser, and passed around as a JSON file. A file comes from anybody, so everything in it is checked before it is
 * used: only what a tournament can take is kept, and a file with anything wrong in it is refused as a whole, not half used.
 */
const KEY = 'slingshot.tournamentTemplates.v1';
/** What a file says it is, so a file of something else is not taken for one. */
export const TEMPLATE_FORMAT = 'slingshot-tournament-template';
export const TEMPLATE_VERSION = 1;
/** The levels a bracket's games are set for: final, semi-finals, quarter-finals, round of 16. */
export const TEMPLATE_STAGES = 4;
export const MAX_TEMPLATES = 12;
export const MAX_TEMPLATE_NAME = 32;
export const TEMPLATE_TEAM_SIZES = [1, 2, 3] as const;
/** A template file is a few kilobytes; anything much bigger is not one. */
export const MAX_TEMPLATE_FILE_BYTES = 64 * 1024;

export interface TemplateStage {
  gameMode: GameMode;
  rules: RoomRules;
}

export interface TournamentTemplate {
  id: string;
  name: string;
  teamSize: number;
  /** `stages[0]` is the final, as the relay counts them. */
  stages: TemplateStage[];
}

export type TemplateError = 'tooBig' | 'notJson' | 'notTemplate' | 'version' | 'name' | 'teamSize' | 'stages' | 'mode' | 'rules';
export type TemplateResult = { ok: true; template: Omit<TournamentTemplate, 'id'> } | { ok: false; error: TemplateError };

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

/**
 * A name made safe to show and to save: no control or invisible formatting characters (which could reorder or hide text), no runs of
 * spaces, cut to length. It is only ever set as text, never as markup; this keeps it readable too.
 */
export function cleanTemplateName(name: string): string {
  return name
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, MAX_TEMPLATE_NAME)
    .trim();
}

/** One level's rules out of a file: every rule there must be one the game has, with a value it allows; rules left out are the standard ones. */
function stageRulesFrom(value: unknown): RoomRules | null {
  if (!isObject(value)) return null;
  for (const [key, rule] of Object.entries(value)) {
    if (!(RULE_KEYS as readonly string[]).includes(key)) return null;
    if (!isLegal(specOf(key as keyof RoomRules), rule)) return null;
  }
  const rules = roomRulesFrom(value as Partial<RoomRules>);
  // A tournament match has to end.
  if (!Number.isInteger(rules.rounds) || rules.rounds < 1) return null;
  return rules;
}

/** A template out of anything (a parsed file, a saved entry): checked whole, nothing of the source shared with the result. */
export function templateFrom(value: unknown): TemplateResult {
  if (!isObject(value) || value.format !== TEMPLATE_FORMAT) return { ok: false, error: 'notTemplate' };
  if (value.version !== TEMPLATE_VERSION) return { ok: false, error: 'version' };
  if (typeof value.name !== 'string') return { ok: false, error: 'name' };
  const name = cleanTemplateName(value.name);
  if (!name) return { ok: false, error: 'name' };
  if (!TEMPLATE_TEAM_SIZES.some((size) => size === value.teamSize)) return { ok: false, error: 'teamSize' };
  if (!Array.isArray(value.stages) || value.stages.length !== TEMPLATE_STAGES) return { ok: false, error: 'stages' };
  const stages: TemplateStage[] = [];
  for (const stage of value.stages) {
    if (!isObject(stage)) return { ok: false, error: 'stages' };
    if (!isGameMode(stage.gameMode)) return { ok: false, error: 'mode' };
    const rules = stageRulesFrom(stage.rules);
    if (!rules) return { ok: false, error: 'rules' };
    stages.push({ gameMode: stage.gameMode, rules });
  }
  return { ok: true, template: { name, teamSize: value.teamSize as number, stages } };
}

/** A file's text to a template; the size is checked before anything is parsed. */
export function parseTemplateFile(text: string): TemplateResult {
  if (new TextEncoder().encode(text).length > MAX_TEMPLATE_FILE_BYTES) return { ok: false, error: 'tooBig' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'notJson' };
  }
  return templateFrom(parsed);
}

/** What a template file holds: what it is, then the settings. No id: that belongs to the browser that keeps it. */
export function templateFile(template: Omit<TournamentTemplate, 'id'>): string {
  return JSON.stringify({
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    name: template.name,
    teamSize: template.teamSize,
    stages: template.stages.map((stage) => ({ gameMode: stage.gameMode, rules: stage.rules })),
  }, null, 2);
}

/** A file name from the template's: letters, digits and dashes only. */
export function templateFileName(name: string): string {
  const base = cleanTemplateName(name).normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${base || 'tournament'}.slingshot-tournament.json`;
}

// ————————————————————————————— Kept in this browser —————————————————————————————

const ID_PATTERN = /^[a-z0-9]{1,24}$/;
const newId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The saved templates, newest first. Anything saved that does not pass the same checks as a file is left out. */
export function loadTemplates(): TournamentTemplate[] {
  let saved: unknown;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(saved)) return [];
  const templates: TournamentTemplate[] = [];
  for (const entry of saved.slice(0, MAX_TEMPLATES)) {
    if (!isObject(entry) || typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) continue;
    const result = templateFrom({ ...entry, format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION });
    if (result.ok && !templates.some((t) => t.id === entry.id)) templates.push({ id: entry.id, ...result.template });
  }
  return templates;
}

function writeTemplates(templates: TournamentTemplate[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(templates.map(({ id, name, teamSize, stages }) => ({ id, name, teamSize, stages }))));
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps a template, first in the list. One of the same name is replaced; past the limit the oldest goes.
 * Null when it does not pass the checks or the browser keeps nothing.
 */
export function saveTemplate(template: Omit<TournamentTemplate, 'id'>): TournamentTemplate | null {
  const result = templateFrom({ format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION, ...template });
  if (!result.ok) return null;
  const saved: TournamentTemplate = { id: newId(), ...result.template };
  const others = loadTemplates().filter((t) => t.name.toLocaleLowerCase() !== saved.name.toLocaleLowerCase());
  return writeTemplates([saved, ...others].slice(0, MAX_TEMPLATES)) ? saved : null;
}

export function deleteTemplate(id: string): void {
  writeTemplates(loadTemplates().filter((t) => t.id !== id));
}
