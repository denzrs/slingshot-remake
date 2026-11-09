import { getLook, type Look } from '../../data/look';
import { classic } from './classic';
import { forged } from './forged';
import { allowShaderStepDown } from './forged-sky';
import { holo } from './holo';
import type { LookPainter } from './painter';

export type { LookPainter } from './painter';

const PAINTERS: Record<Look, LookPainter> = { classic, forged, holo };

/** The painter of `look`: how every element of the field is drawn in it. */
export const painterFor = (look: Look): LookPainter => PAINTERS[look];

/** The painter of the look the player has chosen. */
export const chosenPainter = (): LookPainter => painterFor(getLook());

/** Whether a look may draw its costliest parts at less detail while frames run slow (the player's setting). */
export const allowDetailStepDown = (on: boolean): void => allowShaderStepDown(on);

/** The engraved plan, for screens that stay as they are in every look (the tutorial, the menus). */
export { classic };
