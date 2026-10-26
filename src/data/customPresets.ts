import type { RoomRules } from './roomRules';
import type { GameMode } from '../sim/modes';
import { roomRulesFrom } from './roomRules';

/**
 * What the player keeps of the presets, in this browser only; local games and online rooms share it. Per mode there are
 * two kinds: a saved change to one of the built-in presets (its "override", gone again with a reset to the original),
 * and the player's own presets, each with a name. The table's own switches (betting, who may chat) stay with the table.
 */
const KEY = 'slingshot.presets.v2';

/** As many as fit as strips beside the preset cards. */
export const MAX_CUSTOM_PRESETS = 4;
export const MAX_PRESET_NAME = 24;

export interface CustomPreset {
  id: string;
  name: string;
  rules: RoomRules;
}

interface SavedCustom {
  id: string;
  name: string;
  rules: Partial<RoomRules>;
}

interface SavedMode {
  overrides?: Record<string, Partial<RoomRules>>;
  custom?: SavedCustom[];
}

type Saved = Partial<Record<GameMode, SavedMode>>;

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function readAll(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return isObject(saved) ? (saved as Saved) : {};
  } catch {
    return {};
  }
}

function writeMode(mode: GameMode, saved: SavedMode): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [mode]: saved }));
  } catch {
    // Storage blocked: the rules stay in play for now, but nothing is there next time.
  }
}

const readMode = (mode: GameMode): SavedMode => {
  const saved = readAll()[mode];
  return isObject(saved) ? saved : {};
};

const stored = (rules: RoomRules): Partial<RoomRules> => {
  const { betting: _betting, chatPlayersOnly: _chat, ...kept } = rules;
  return { ...kept, powerUpKinds: [...kept.powerUpKinds] };
};

const restored = (saved: Partial<RoomRules>): RoomRules => ({ ...roomRulesFrom(saved), betting: false, chatPlayersOnly: false });

/** A name that fits on a card: trimmed, with no runs of spaces, cut to length. */
export const cleanPresetName = (name: string): string => name.replace(/\s+/g, ' ').trim().slice(0, MAX_PRESET_NAME);

// ————————————————————————————— Built-in presets, changed and kept —————————————————————————————

/** The rules the player saved over a built-in preset, or null while it is as shipped. */
export function loadOverride(mode: GameMode, preset: string): RoomRules | null {
  const saved = readMode(mode).overrides?.[preset];
  return isObject(saved) ? restored(saved) : null;
}

export function saveOverride(mode: GameMode, preset: string, rules: RoomRules): void {
  const saved = readMode(mode);
  writeMode(mode, { ...saved, overrides: { ...saved.overrides, [preset]: stored(rules) } });
}

/** Back to the original. */
export function clearOverride(mode: GameMode, preset: string): void {
  const saved = readMode(mode);
  if (!saved.overrides || !(preset in saved.overrides)) return;
  const { [preset]: _gone, ...rest } = saved.overrides;
  writeMode(mode, { ...saved, overrides: rest });
}

// ————————————————————————————— The player's own presets —————————————————————————————

export function loadCustomPresets(mode: GameMode): CustomPreset[] {
  const list = readMode(mode).custom;
  if (!Array.isArray(list)) return [];
  return list
    .filter((entry): entry is SavedCustom => isObject(entry) && typeof entry.id === 'string' && typeof entry.name === 'string' && isObject(entry.rules))
    .slice(0, MAX_CUSTOM_PRESETS)
    .map(({ id, name, rules }) => ({ id, name: cleanPresetName(name) || id, rules: restored(rules) }));
}

/**
 * Keeps a preset: a new one (no `id`) joins the list, one that exists is replaced in its place. Null once the list is
 * full, or when the id is gone (deleted somewhere else in the meantime).
 */
export function saveCustomPreset(mode: GameMode, preset: { id?: string; name: string; rules: RoomRules }): CustomPreset | null {
  const list = loadCustomPresets(mode);
  const name = cleanPresetName(preset.name);
  if (!name) return null;
  const index = preset.id ? list.findIndex((entry) => entry.id === preset.id) : -1;
  if (preset.id && index < 0) return null;
  if (index < 0 && list.length >= MAX_CUSTOM_PRESETS) return null;
  const kept: CustomPreset = { id: preset.id ?? Math.random().toString(36).slice(2, 10), name, rules: restored(stored(preset.rules)) };
  const next = index < 0 ? [...list, kept] : list.map((entry, i) => (i === index ? kept : entry));
  writeMode(mode, { ...readMode(mode), custom: next.map((entry) => ({ id: entry.id, name: entry.name, rules: stored(entry.rules) })) });
  return kept;
}

export function deleteCustomPreset(mode: GameMode, id: string): void {
  const saved = readMode(mode);
  writeMode(mode, { ...saved, custom: loadCustomPresets(mode).filter((entry) => entry.id !== id).map((entry) => ({ id: entry.id, name: entry.name, rules: stored(entry.rules) })) });
}
