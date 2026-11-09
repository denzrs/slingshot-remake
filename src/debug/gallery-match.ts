import { createMatch, type Match } from '../game';
import { DEFAULT_SETTINGS, type Seat } from '../data/settings';
import type { DrawOptions } from '../render/renderer';
import type { PlanetStyle } from '../sim/physics';

/** What the galleries (`/dev/looks.html`, `/dev/planets.html`) draw of a field: the field alone, no HUD and no hints. */
export const GALLERY_OPTIONS: DrawOptions = { hud: false, fullScreen: false, touch: false, recording: false, keyHints: false, aimCardDodge: false, seatNumbers: false };

/** A match's settings for a gallery: quiet, and without the menu's background. */
export const gallerySettings = (seats: Seat[], extra: Partial<typeof DEFAULT_SETTINGS> = {}) => ({
  ...DEFAULT_SETTINGS,
  seats,
  rounds: 5,
  menuBackground: false,
  menuSounds: false,
  gameSounds: false,
  ...extra,
});

const HUMANS: Seat[] = ['human', 'human', 'human', 'off', 'off', 'off'];

/** A match standing at the start of a round's aiming, with nobody steering. */
export function aiming(mode: 'classic' | 'horizon' | 'solar', seed: number, extra: Partial<typeof DEFAULT_SETTINGS> = {}): Match {
  const match = createMatch(mode, gallerySettings(HUMANS, extra), { seats: HUMANS, names: ['Ash', 'Bo', 'Cy'], seed });
  match.phase = 'aiming';
  return match;
}

/** What the galleries call each style of planet. */
export const STYLE_NAMES: Record<PlanetStyle, string> = { rocky: 'Fels', gas: 'Gas', ice: 'Eis', lava: 'Lava', star: 'Stern' };
