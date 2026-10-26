let artSequence = 0;

export function nextSpaceArtId(prefix: string): string {
  return `${prefix}-${++artSequence}`;
}

/** Shared SVG primitives for all Slingshot mode and preset illustrations. */
export function spaceArt(id: string) {
  const ship = (x: number, y: number, angle: number, color: string, scale = 1, className = '') =>
    `<use href="#${id}-ship"${className ? ` class="${className}"` : ''} transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})" fill="${color}"/>`;
  const planet = (x: number, y: number, r: number, warm = false, ghost = false) => ghost
    ? `<circle cx="${x}" cy="${y}" r="${r + 4}" fill="none" stroke="${warm ? '#ffad65' : '#6fe3c8'}" stroke-opacity=".12"/><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${warm ? '#e8b27b' : '#8bdacb'}" stroke-opacity=".7" stroke-dasharray="3 5"/>`
    : `<circle cx="${x}" cy="${y}" r="${r + 4}" fill="${warm ? '#ffad65' : '#6fe3c8'}" opacity=".035"/><circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id}-${warm ? 'warm' : 'planet'})" stroke="${warm ? '#e8b27b' : '#8bdacb'}" stroke-opacity=".4"/><ellipse cx="${x - r * .25}" cy="${y - r * .25}" rx="${r * .55}" ry="${r * .18}" fill="#e8e4d8" opacity=".11" transform="rotate(-25 ${x} ${y})"/>`;
  const sun = (x = 160, y = 100, scale = 1) => `<circle cx="${x}" cy="${y}" r="${46 * scale}" fill="#f2c46d" opacity=".06"/><circle cx="${x}" cy="${y}" r="${31 * scale}" fill="#f2c46d" opacity=".1"/><circle cx="${x}" cy="${y}" r="${19 * scale}" fill="#f2c46d" stroke="#fff0cf" stroke-opacity=".75" stroke-width="${1.5 * scale}"/><circle cx="${x}" cy="${y}" r="${11 * scale}" fill="#ffe7a8" opacity=".8"/>`;
  const singularity = (x: number, y: number, r: number, angle = -24) => `
    <g>
      <ellipse cx="${x}" cy="${y}" rx="${r * 1.9}" ry="${r * .72}" transform="rotate(${angle} ${x} ${y})" fill="none" stroke="#90c5cf" stroke-width="8" stroke-opacity=".12"/>
      <ellipse cx="${x}" cy="${y}" rx="${r * 1.9}" ry="${r * .72}" transform="rotate(${angle} ${x} ${y})" fill="none" stroke="#f4d2a0" stroke-width="2.4" stroke-opacity=".78"/>
      <ellipse cx="${x}" cy="${y}" rx="${r * 1.45}" ry="${r * .52}" transform="rotate(${angle} ${x} ${y})" fill="none" stroke="#ffad65" stroke-width="1" stroke-dasharray="5 7" stroke-opacity=".86"/>
      <circle cx="${x}" cy="${y}" r="${r}" fill="#020711" stroke="#b8d4d5" stroke-width="1.25" stroke-opacity=".8"/>
      <circle cx="${x}" cy="${y}" r="${r * .77}" fill="#00030a"/>
      <path d="M${x - r * .82} ${y - r * .62}a${r} ${r} 0 0 1 ${r * 1.58} ${r * .08}" fill="none" stroke="#fff0cf" stroke-width="1.2" stroke-linecap="round" opacity=".8"/>
    </g>`;
  const defs = `<defs>
    <radialGradient id="${id}-planet" cx="30%" cy="25%"><stop stop-color="#9cc9bd"/><stop offset=".55" stop-color="#416c76"/><stop offset="1" stop-color="#142c42"/></radialGradient>
    <radialGradient id="${id}-warm" cx="30%" cy="25%"><stop stop-color="#e4bb82"/><stop offset=".6" stop-color="#a47756"/><stop offset="1" stop-color="#3d3440"/></radialGradient>
    <radialGradient id="${id}-glow"><stop stop-color="#294b65" stop-opacity=".4"/><stop offset="1" stop-color="#122039" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}-void"><stop offset=".72" stop-color="#00020a"/><stop offset="1" stop-color="#101c2a"/></radialGradient>
    <path id="${id}-ship" d="M0-13 8 8 0 4-8 8Zm0 20 3 7-3-2-3 2Z"/>
  </defs>`;

  return {
    defs,
    glow: '<ellipse cx="160" cy="105" rx="150" ry="100" fill="url(#' + id + '-glow)"/>',
    ship,
    planet,
    sun,
    singularity,
  };
}
