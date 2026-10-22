export type ModeArt = 'daily' | 'classic' | 'horizon' | 'mayhem' | 'trickshot' | 'sniper' | 'party' | 'rooms' | 'create' | 'code';
let artId = 0;

/** Orbital charts for the menu, drawn as vectors so they stay crisp on phones and large screens. */
export function modeArt(kind: ModeArt): SVGElement {
  const id = `orbit-${++artId}`;
  const ship = (x: number, y: number, angle: number, color: string, scale = 1) =>
    `<use href="#${id}-ship" transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})" fill="${color}"/>`;
  const planet = (x: number, y: number, r: number, warm = false) =>
    `<circle cx="${x}" cy="${y}" r="${r + 4}" fill="${warm ? '#ffad65' : '#6fe3c8'}" opacity=".035"/><circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id}-${warm ? 'warm' : 'planet'})" stroke="${warm ? '#e8b27b' : '#8bdacb'}" stroke-opacity=".4"/><ellipse cx="${x - r * .25}" cy="${y - r * .25}" rx="${r * .55}" ry="${r * .18}" fill="#e8e4d8" opacity=".11" transform="rotate(-25 ${x} ${y})"/>`;
  const orbit = (rx: number, ry: number, angle: number, color = '#7697ae', opacity = '.3') =>
    `<ellipse cx="160" cy="100" rx="${rx}" ry="${ry}" transform="rotate(${angle} 160 100)" fill="none" stroke="${color}" stroke-opacity="${opacity}"/>`;
  const stars = [[18, 28], [67, 14], [110, 167], [284, 23], [253, 155], [197, 29], [40, 156], [299, 117], [140, 37], [91, 88], [219, 176], [275, 78]]
    .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 4 === 0 ? 1.5 : .8}" fill="#e8e4d8" opacity="${i % 3 === 0 ? '.65' : '.25'}"/>`).join('');
  let scene: string;
  switch (kind) {
    case 'rooms':
      scene = `${orbit(132, 57, -18)}${orbit(90, 34, -18)}${planet(160, 98, 24)}
        <g fill="none" stroke="#6fe3c8" stroke-width="1.5"><circle cx="160" cy="98" r="69"/><path d="M160 29v69l59-35" fill="#6fe3c8" fill-opacity=".05"/></g>
        <circle cx="219" cy="63" r="5" fill="#ffad65"/>${ship(63, 140, 38, '#e8e4d8', 1.2)}${ship(262, 71, -130, '#6fe3c8', .8)}`;
      break;
    case 'create':
      scene = `${orbit(130, 50, -20)}${planet(110, 105, 32)}${ship(237, 69, 25, '#e8e4d8', 1.7)}
        <path d="M164 146Q190 155 212 124" stroke="#6fe3c8" stroke-width="2" fill="none"/>
        <g fill="none" stroke="#ffad65" stroke-width="2"><circle cx="222" cy="133" r="23"/><path d="M222 120v26m-13-13h26"/></g>`;
      break;
    case 'code':
      scene = `${orbit(125, 49, -22)}${planet(261, 45, 13)}
        <rect x="70" y="54" width="180" height="96" rx="7" fill="#0c2035" stroke="#6fe3c8" stroke-opacity=".5"/>
        <g fill="none" stroke="#ffad65" stroke-width="2"><rect x="91" y="86" width="23" height="32" rx="3"/><rect x="129" y="86" width="23" height="32" rx="3"/><rect x="167" y="86" width="23" height="32" rx="3"/><rect x="205" y="86" width="23" height="32" rx="3"/></g><g fill="#ffad65"><circle cx="102.5" cy="102" r="3"/><circle cx="140.5" cy="102" r="3"/><circle cx="178.5" cy="102" r="3"/><circle cx="216.5" cy="102" r="3"/></g>
        ${ship(40, 159, 55, '#e8e4d8', .9)}`;
      break;
    case 'classic':
      scene = `${orbit(142, 58, -20)}${orbit(105, 38, -20)}${orbit(66, 24, -20)}
        <path d="M14 158 C49 173 83 141 96 96 S161 16 223 50 S264 136 302 92" fill="none" stroke="#6fe3c8" stroke-width="1.8"/>
        <path d="M17 156 C52 166 79 139 91 107" fill="none" stroke="#6fe3c8" stroke-width="6" opacity=".08"/>
        <path d="M282 30 C252 23 215 36 194 71 S154 158 109 165" fill="none" stroke="#ffad65" stroke-width="1.5" stroke-dasharray="4 5"/>
        ${planet(154, 101, 30)}${planet(254, 48, 12, true)}${planet(60, 127, 7, true)}
        ${ship(30, 159, 78, '#6fe3c8', .95)}${ship(280, 30, -100, '#ffad65', .9)}`;
      break;
    case 'horizon':
      scene = `${[94, 80, 68, 58].map((r) => orbit(r * 1.4, r * .45, -24, '#aac3d6', String(.14 + (94 - r) / 140))).join('')}
        <ellipse cx="160" cy="100" rx="76" ry="30" transform="rotate(-24 160 100)" fill="none" stroke="#90c5cf" stroke-width="12" opacity=".06"/>
        <circle cx="160" cy="100" r="35" fill="#060c18" stroke="#aeced2" stroke-width="1.5"/>
        <path d="M78 136 C114 142 156 128 190 110 S230 78 235 59" fill="none" stroke="#f4d2a0" stroke-width="3"/>
        <path d="M71 141 C113 151 181 120 219 89" fill="none" stroke="#f4d2a0" stroke-width="1" opacity=".45"/>
        <path d="M34 43 Q111 8 128 54" fill="none" stroke="#6fe3c8" stroke-dasharray="3 4" opacity=".6"/>
        ${planet(267, 142, 10)}${ship(40, 40, 65, '#6fe3c8', .9)}${ship(244, 49, 155, '#ffad65', .75)}`;
      break;
    case 'mayhem':
    case 'party':
      scene = `${orbit(146, 43, -30, '#6fe3c8', '.65')}${orbit(120, 55, 30, '#ffad65', '.6')}${orbit(80, 79, -16, '#829fce', '.6')}
        ${planet(153, 97, 25, true)}${planet(65, 127, 15)}${planet(241, 58, 12)}${planet(214, 154, 8, true)}
        <g fill="#ffad65"><path d="m89 36 5 12 13-3-8 11 8 11-13-3-5 12-4-12-13 3 8-11-8-11 13 3Z"/><path d="m244 125 3 9 10 1-8 6 2 10-7-6-8 6 3-10-8-6 10-1Z"/></g>
        <circle cx="207" cy="38" r="12" fill="#112c3c" stroke="#6fe3c8"/><path d="m209 29-8 11h6l-2 8 9-12h-6Z" fill="#6fe3c8"/>
        ${ship(36, 147, 52, '#6fe3c8', .9)}${ship(261, 93, -48, '#ffad65', .9)}`;
      break;
    case 'sniper':
      scene = `${planet(42, 165, 42)}${planet(266, 34, 18, true)}
        <g fill="none" stroke="#6fe3c8" stroke-width="1.5"><circle cx="162" cy="95" r="38"/><path d="M162 43v35m0 34v35m-52-52h35m34 0h35"/></g>
        <circle cx="162" cy="95" r="3" fill="#ffad65"/><path d="M56 152 138 109m46-27 59-35" stroke="#ffad65" stroke-dasharray="3 5" opacity=".7"/>
        ${ship(66, 146, 57, '#e8e4d8', 1)}`;
      break;
    case 'trickshot':
      scene = `${planet(164, 101, 29)}${planet(255, 57, 11, true)}
        <path d="M21 146Q68 177 92 105T191 39Q243 47 295 19L295 137 229 171" fill="none" stroke="#6fe3c8" stroke-width="2"/>
        <path d="M295 19v118l-66 34" fill="none" stroke="#ffad65" stroke-width="2"/>
        <path d="M295 6v145" stroke="#ffad65" opacity=".35" stroke-width="5"/>
        <circle cx="295" cy="19" r="5" fill="#ffad65"/>${ship(32, 153, 78, '#e8e4d8', 1)}`;
      break;
    case 'daily':
      scene = `${orbit(122, 48, -25)}${planet(204, 101, 38)}
        <g fill="none" stroke="#ffad65" stroke-width="2"><circle cx="95" cy="65" r="26"/><circle cx="95" cy="65" r="15"/><path d="m95 65 29-30m-9 0h9v9"/></g>
        <path d="M30 171 Q90 183 146 115" fill="none" stroke="#6fe3c8" stroke-width="1.5"/>${ship(136, 125, 40, '#e8e4d8', 1.6)}`;
      break;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 320 196');
  svg.setAttribute('class', 'mode-art');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<defs>
    <radialGradient id="${id}-planet" cx="30%" cy="25%"><stop stop-color="#9cc9bd"/><stop offset=".55" stop-color="#416c76"/><stop offset="1" stop-color="#142c42"/></radialGradient>
    <radialGradient id="${id}-warm" cx="30%" cy="25%"><stop stop-color="#e4bb82"/><stop offset=".6" stop-color="#a47756"/><stop offset="1" stop-color="#3d3440"/></radialGradient>
    <radialGradient id="${id}-glow"><stop stop-color="#294b65" stop-opacity=".4"/><stop offset="1" stop-color="#122039" stop-opacity="0"/></radialGradient>
    <path id="${id}-ship" d="M0-13 8 8 0 4-8 8Zm0 20 3 7-3-2-3 2Z"/>
  </defs><ellipse cx="160" cy="105" rx="150" ry="100" fill="url(#${id}-glow)"/>${stars}${scene}`;
  return svg;
}

/** A crew member's actual ship, deliberately simpler than a mode illustration. */
export function pilotArt(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 160 100');
  svg.setAttribute('class', 'pilot-art');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<ellipse cx="80" cy="56" rx="64" ry="25" fill="none" stroke="currentColor" stroke-opacity=".15" transform="rotate(-18 80 56)"/><path d="M80 12 105 73 80 61 55 73Z" fill="currentColor"/><path d="m80 27 9 24H71Z" fill="#081426"/><path d="M75 70v12m10-12v12m-5-10v19" stroke="currentColor" stroke-opacity=".4" stroke-width="2"/>';
  return svg;
}
