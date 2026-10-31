import { getLook, type Look } from '../../data/look';
import { classic } from './classic';
import { forged } from './forged';
import { holo } from './holo';
import { luminous } from './luminous';
import type { LookPainter } from './painter';

export type { LookPainter } from './painter';

const PAINTERS: Record<Look, LookPainter> = { classic, luminous, forged, holo };

/** The painter of `look`: how every element of the field is drawn in it. */
export const painterFor = (look: Look): LookPainter => PAINTERS[look];

/** The painter of the look the player has chosen. */
export const chosenPainter = (): LookPainter => painterFor(getLook());

/** The engraved plan, for screens that stay as they are in every look (the tutorial, the menus). */
export { classic };
