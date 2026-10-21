/** The game modes that get a card on the local menu. */
export type ModeIcon = 'daily' | 'classic' | 'horizon' | 'mayhem';

/**
 * One small drawing per mode, in the colours of the page: the line is bone, and the one thing the mode is about
 * (the target, the shot, the hole, the spark) carries the accent colour.
 */
const DRAWINGS: Record<ModeIcon, string> = {
  // A target with a ship's line of fire coming in.
  daily: `<circle cx="32" cy="24" r="17" class="ico-line"/><circle cx="32" cy="24" r="10" class="ico-line"/><circle cx="32" cy="24" r="3" class="ico-accent-fill"/><path d="M4 42 L26 27" class="ico-accent"/>`,
  // A shot bending round a planet, between two ships.
  classic: `<circle cx="32" cy="26" r="9" class="ico-line"/><path d="M7 38 C 14 8, 50 8, 57 38" class="ico-accent" stroke-dasharray="3 3"/><path d="M4 42 l6 -8 l2 8 z" class="ico-line"/><path d="M60 42 l-6 -8 l-2 8 z" class="ico-line"/>`,
  // A black hole with its ring.
  horizon: `<ellipse cx="32" cy="24" rx="26" ry="8" class="ico-accent" transform="rotate(-14 32 24)"/><circle cx="32" cy="24" r="10" class="ico-fill"/><circle cx="32" cy="24" r="10" class="ico-line"/>`,
  // Planets, a spark, and orbits gone wrong.
  mayhem: `<path d="M34 3 L22 27 h10 l-4 18 L46 18 H35 z" class="ico-accent-fill"/><circle cx="10" cy="12" r="5" class="ico-line"/><circle cx="54" cy="36" r="6" class="ico-line"/><circle cx="12" cy="38" r="2.5" class="ico-line"/><circle cx="54" cy="10" r="2.5" class="ico-line"/>`,
};

export function modeIcon(kind: ModeIcon): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 48');
  svg.setAttribute('class', 'mode-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = DRAWINGS[kind];
  return svg;
}
