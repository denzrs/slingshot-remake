import { AVATAR_PATHS, type Avatar } from '../avatars';

const paths = new Map<Avatar, Path2D>();

/** A symbol as a canvas path, built once per symbol. Its cut-outs are holes (even-odd). */
function pathOf(avatar: Avatar): Path2D {
  let path = paths.get(avatar);
  if (!path) {
    path = new Path2D(AVATAR_PATHS[avatar].join(' '));
    paths.set(avatar, path);
  }
  return path;
}

/** Draws a symbol centred on (x, y), `size` across, in `color`; sizes are in the units of the current transform. */
export function drawAvatar(ctx: CanvasRenderingContext2D, avatar: Avatar, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.fill(pathOf(avatar), 'evenodd');
  ctx.restore();
}
