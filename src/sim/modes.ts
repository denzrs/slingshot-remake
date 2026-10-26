/** The games a match can be played in, in the order the menus list them. */
export const GAME_MODES = ['classic', 'horizon', 'solar'] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const isGameMode = (value: unknown): value is GameMode => GAME_MODES.some((mode) => mode === value);

/** Classic and the Solar System, which plays Classic's rules; Event Horizon shows its planets and scores trick shots anyway. */
export const CLASSIC_FAMILY: readonly GameMode[] = ['classic', 'solar'];
