type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A colour moved toward white by `amount` (0 → 1). */
export function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.round(c + (255 - c) * amount));
  return `rgb(${r},${g},${b})`;
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** `rgba(hex, alpha)` for one fixed alpha, each colour's string made once: for what is drawn by the thousand every frame, like sparks. */
export function rgbaAt(alpha: number): (hex: string) => string {
  const made = new Map<string, string>();
  return (hex) => {
    let color = made.get(hex);
    if (color === undefined) made.set(hex, (color = rgba(hex, alpha)));
    return color;
  };
}
