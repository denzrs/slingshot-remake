/** The shape of the black hole's picture (`forged/hole.webp`, made by `scripts/forged/hole-frames.mjs`): a sheet of frames of the disk turning. */

/** A frame is this many pixels across. The hole spans `HOLE_SPAN` shadow radii across it. */
export const FRAME = 512;
/** The picture is a square `FRAME` across, but the disk is flat: a frame keeps only the band of `FRAME_H` rows starting `BAND_TOP` rows down. */
export const FRAME_H = 256;
export const BAND_TOP = 118;
/** The black hole's image, the shadow at the middle, covers this many shadow radii across. */
export const HOLE_SPAN = 8.2;
/** How many frames the sheet holds, in this many columns, and the seconds in which the disk's rings turn a whole number of times (so the last frame leads into the first). */
export const FRAMES = 96;
export const COLUMNS = 6;
export const LOOP = 6;

/**
 * The white hole's light (`forged/white.webp`, made by the same script): only the shadow, cut out of each frame as a square
 * `WHITE_FRAME` across round the middle, at the hole's own scale, and as many frames on the same loop, so the two play in
 * step. `WHITE_COLUMNS` to a row.
 */
export const WHITE_FRAME = 136;
export const WHITE_COLUMNS = 12;
