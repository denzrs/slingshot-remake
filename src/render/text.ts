/** The text, cut with an ellipsis if it doesn't fit the width in the current font. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text.length;
  while (cut > 1 && ctx.measureText(`${text.slice(0, cut)}…`).width > width) cut--;
  return `${text.slice(0, cut)}…`;
}

/**
 * The parts (words, names) laid out in at most `maxLines` lines no wider than `width` in the current font, filling each
 * line before starting the next. What does not fit in the last line is cut with an ellipsis, and a part wider than a line
 * is cut the same way, so no line is ever too wide.
 */
export function wrapParts(ctx: CanvasRenderingContext2D, parts: string[], separator: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  parts.forEach((part, i) => {
    const joined = line ? `${line}${separator}${part}` : part;
    if (!line || ctx.measureText(joined).width <= width || lines.length === maxLines - 1) line = joined;
    else {
      lines.push(line);
      line = part;
    }
    if (i === parts.length - 1) lines.push(line);
  });
  return lines.map((text) => fitText(ctx, text, width));
}

export function setSpacing(ctx: CanvasRenderingContext2D, px: number): void {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
}
