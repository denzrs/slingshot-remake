import type { NetworkGameMode, RoomRules } from './net';
import { roomRulesFrom } from './lobbyPrefs';

/**
 * "My rules": one set of rules per mode that the player saved for themselves, in this browser only. Local games and
 * online rooms share it. The table's own switches (betting, who may chat) stay with the table and are not saved.
 */
const KEY = 'slingshot.presets.v1';

/** How long the card waits for the second click that replaces saved rules. */
export const CONFIRM_OVERWRITE_MS = 5_000;

type SavedPresets = Partial<Record<NetworkGameMode, Partial<RoomRules>>>;

function readAll(): SavedPresets {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

/** The player's saved rules for a mode, or null while the slot is empty. */
export function loadCustomPreset(mode: NetworkGameMode): RoomRules | null {
  const saved = readAll()[mode];
  if (!saved || typeof saved !== 'object') return null;
  return { ...roomRulesFrom(saved), betting: false, chatPlayersOnly: false };
}

export function saveCustomPreset(mode: NetworkGameMode, rules: RoomRules): void {
  const { betting: _betting, chatPlayersOnly: _chat, ...kept } = rules;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [mode]: { ...kept, powerUpKinds: [...kept.powerUpKinds] } }));
  } catch {
    // Storage blocked: the rules stay in play for now, but the slot stays empty next time.
  }
}
