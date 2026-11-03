/** The shape of the black hole's picture (`forged/hole.webp`, made by `scripts/forged/hole-frames.mjs`): a sheet of frames of the disk turning. */

/** A frame is this many pixels across. The hole spans `HOLE_SPAN` shadow radii across it. */
export const FRAME = 256;
/** The black hole's image, the shadow at the middle, covers this many shadow radii across. */
export const HOLE_SPAN = 8.2;
/** How many frames the sheet holds, in this many columns, and the seconds in which the disk's rings turn a whole number of times (so the last frame leads into the first). */
export const FRAMES = 32;
export const COLUMNS = 8;
export const LOOP = 8;
