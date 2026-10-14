/**
 * How a multiplayer room presents itself in the lobby: whether it is listed, and the symbol and colour
 * it wears. The choices are fixed — the relay refuses anything else (see `server/protocol-contract.json`,
 * which both sides are checked against). Rooms have no names of their own: they are numbered.
 */

export const ROOM_VISIBILITIES = ['public', 'private'] as const;
export type RoomVisibility = (typeof ROOM_VISIBILITIES)[number];

export const ROOM_SYMBOLS = ['planet', 'moon', 'star', 'sun', 'comet', 'blackhole', 'ufo', 'asteroid'] as const;
export type RoomSymbol = (typeof ROOM_SYMBOLS)[number];

export const ROOM_COLORS = ['#ff8660', '#ffd27a', '#c6e86a', '#6fe3c8', '#62b6ff', '#b99cff', '#ff6f9f', '#e8e4d8'] as const;
export type RoomColor = (typeof ROOM_COLORS)[number];

export interface RoomLook {
  visibility: RoomVisibility;
  symbol: RoomSymbol;
  color: RoomColor;
}

export const DEFAULT_ROOM_LOOK: RoomLook = { visibility: 'public', symbol: 'planet', color: ROOM_COLORS[0] };

const choice = <T extends string>(options: readonly T[], value: unknown, fallback: T): T => (options as readonly unknown[]).includes(value) ? (value as T) : fallback;

/** A room look from storage: whatever is not a known choice falls back to the default for that field. */
export function roomLookFrom(saved: unknown): RoomLook {
  const fields = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  return {
    visibility: choice(ROOM_VISIBILITIES, fields.visibility, DEFAULT_ROOM_LOOK.visibility),
    symbol: choice(ROOM_SYMBOLS, fields.symbol, DEFAULT_ROOM_LOOK.symbol),
    color: choice(ROOM_COLORS, fields.color, DEFAULT_ROOM_LOOK.color),
  };
}
