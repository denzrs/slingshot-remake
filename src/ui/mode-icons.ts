import type { GameMode } from '../modes';
import type { MatchPreset } from './match-presets';
import { nextSpaceArtId, spaceArt } from './space-art';

export type ModeArt = 'daily' | 'classic' | 'solar' | 'horizon' | 'trickshot' | 'simultaneous' | 'rooms' | 'create' | 'code' | 'customAdd';
export type MatchPresetArt = 'standard' | 'trickshot';
export type MayhemPresetArt = 'wildClassic' | 'insaneHorizon';
export type SolarPresetArt = 'powerups' | 'mayhem';
export type PresetArtTreatment =
  | { mode: 'horizon'; preset: MatchPresetArt }
  | { mode: 'solar'; preset: SolarPresetArt }
  | { mode: 'mayhem'; preset: MayhemPresetArt };
/** The card of a regular preset in a mode: Event Horizon's own take on it, simultaneous fire, or the wild orbits of Mayhem. The Solar System has its own sun on all of them. */
export function presetArt(preset: MatchPreset, mode: GameMode): SVGElement {
  if (mode === 'solar') return modeArt('solar', preset === 'powerups' || preset === 'mayhem' ? { mode: 'solar', preset } : undefined);
  if (preset === 'mayhem') return modeArt(mode === 'horizon' ? 'horizon' : 'classic', { mode: 'mayhem', preset: mode === 'horizon' ? 'insaneHorizon' : 'wildClassic' });
  if (preset === 'simultaneous') return modeArt('simultaneous');
  // Power-ups is the Solar System's own card, handled above.
  if (preset === 'powerups') return modeArt('classic');
  return modeArt(preset === 'standard' ? 'classic' : preset, mode === 'horizon' ? { mode: 'horizon', preset } : undefined);
}

/** Orbital charts for the menu, drawn as vectors so they stay crisp on phones and large screens. */
export function modeArt(kind: ModeArt, treatment?: PresetArtTreatment): SVGElement {
  const id = nextSpaceArtId('orbit');
  const art = spaceArt(id);
  const { ship, planet, singularity } = art;
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
    case 'solar':
      scene = `${orbit(52, 28, -8, '#f2c46d', '.4')}${orbit(92, 49, -8, '#7697ae', '.32')}${orbit(132, 70, -8, '#7697ae', '.3')}${orbit(150, 82, -8, '#6fe3c8', '.4')}${art.sun()}
        ${planet(212, 100, 8, true)}${planet(79, 72, 11)}${planet(214, 143, 6)}
        <path d="M42 150C70 164 98 135 112 108s33-62 70-55" fill="none" stroke="#6fe3c8" stroke-width="1.7" stroke-dasharray="4 4"/>
        ${ship(38, 141, 58, '#6fe3c8', .9)}${ship(282, 66, -120, '#ffad65', .85)}`;
      break;
    case 'simultaneous':
      scene = `${orbit(141, 54, -19, '#6fe3c8', '.45')}${orbit(121, 47, 24, '#ffad65', '.4')}
        ${planet(163, 99, 27)}${planet(57, 62, 9, true)}${planet(267, 143, 9)}
        <path d="M20 43Q79 59 117 83T205 105 297 63" fill="none" stroke="#6fe3c8" stroke-width="1.8"/>
        <path d="M19 153Q80 135 119 114T202 91 298 142" fill="none" stroke="#ffad65" stroke-width="1.8"/>
        <path d="M55 173Q93 143 125 109T190 57 285 28" fill="none" stroke="#bc92ff" stroke-width="1.5" stroke-dasharray="3 4"/>
        ${ship(20, 43, 18, '#6fe3c8', .86)}${ship(19, 153, -17, '#ffad65', .86)}${ship(55, 173, -36, '#bc92ff', .82)}
        <g fill="#fff0cf"><circle cx="117" cy="83" r="2.5"/><circle cx="119" cy="114" r="2.5"/><circle cx="125" cy="109" r="2.5"/></g>`;
      break;
    case 'horizon':
      scene = `${singularity(160, 100, 35)}
        <path d="M78 136 C114 142 156 128 190 110 S230 78 235 59" fill="none" stroke="#f4d2a0" stroke-width="3"/>
        <path d="M71 141 C113 151 181 120 219 89" fill="none" stroke="#f4d2a0" stroke-width="1" opacity=".45"/>
        <path d="M34 43 Q111 8 128 54" fill="none" stroke="#6fe3c8" stroke-dasharray="3 4" opacity=".6"/>
        ${planet(267, 142, 10)}${ship(40, 40, 65, '#6fe3c8', .9)}${ship(244, 49, 155, '#ffad65', .75)}`;
      break;
    case 'trickshot':
      scene = `${planet(164, 101, 29)}${planet(255, 57, 11, true)}
        <path d="M21 146Q68 177 92 105T191 39Q243 47 295 19L295 137 229 171" fill="none" stroke="#6fe3c8" stroke-width="2"/>
        <path d="M295 19v118l-66 34" fill="none" stroke="#ffad65" stroke-width="2"/>
        <path d="M295 6v145" stroke="#ffad65" opacity=".35" stroke-width="5"/>
        <circle cx="295" cy="19" r="5" fill="#ffad65"/>${ship(32, 153, 78, '#e8e4d8', 1)}`;
      break;
    case 'customAdd':
      // An empty slot: a dashed orbit around a plus.
      scene = `<ellipse cx="160" cy="100" rx="96" ry="62" fill="none" stroke="#ffad65" stroke-opacity=".5" stroke-width="2" stroke-dasharray="6 9"/>
        <circle cx="160" cy="100" r="34" fill="#ffad65" opacity=".08"/><circle cx="160" cy="100" r="30" fill="none" stroke="#ffad65" stroke-width="2"/>
        <path d="M160 82v36M142 100h36" stroke="#ffad65" stroke-width="4" stroke-linecap="round"/>`;
      break;
    case 'daily':
      scene = `${orbit(122, 48, -25)}${planet(204, 101, 38)}
        <g fill="none" stroke="#ffad65" stroke-width="2"><circle cx="95" cy="65" r="26"/><circle cx="95" cy="65" r="15"/><path d="m95 65 29-30m-9 0h9v9"/></g>
        <path d="M30 171 Q90 183 146 115" fill="none" stroke="#6fe3c8" stroke-width="1.5"/>${ship(136, 125, 40, '#e8e4d8', 1.6)}`;
      break;
  }
  if (treatment?.mode === 'solar') {
    const sun = art.sun();
    switch (treatment.preset) {
      // One shot bends round the sun and collects three pick-ups on the way (preview, teleport, shield); a fourth, the splitter, waits below.
      case 'powerups': {
        const orb = (x: number, y: number, color: string, symbol: string) =>
          `<circle cx="${x}" cy="${y}" r="21" fill="${color}" opacity=".1"/><circle cx="${x}" cy="${y}" r="15" fill="#0c2035" stroke="${color}" stroke-width="1.6"/><g fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${symbol}</g>`;
        scene = `${orbit(52, 28, -8, '#f2c46d', '.35')}${orbit(92, 49, -8, '#7697ae', '.3')}${orbit(150, 82, -8, '#7697ae', '.4')}${sun}
          ${planet(58, 66, 10)}${planet(198, 152, 7)}${planet(284, 118, 8, true)}
          <path d="M34 146Q130 30 292 62" fill="none" stroke="#6fe3c8" stroke-width="6" opacity=".08"/>
          <path d="M34 146Q130 30 292 62" fill="none" stroke="#6fe3c8" stroke-width="1.8" stroke-dasharray="5 4"/>
          ${orb(98, 90, '#3ff0ff', '<path d="M89 90Q98 80 107 90Q98 100 89 90Z"/><circle cx="98" cy="90" r="2.4" fill="#3ff0ff"/>')}
          ${orb(160, 63, '#ff4fd8', '<circle cx="160" cy="63" r="8"/><circle cx="160" cy="63" r="2.6" fill="#ff4fd8"/>')}
          ${orb(230, 55, '#4dffb0', '<path d="M222 48H238Q238 60 230 66Q222 60 222 48Z" fill="#4dffb0" fill-opacity=".25"/><path d="M226 56 230 51 234 56"/>')}
          ${orb(246, 140, '#ffd21f', '<path d="M240 149 236 132M240 149 246 131M240 149 256 135"/><circle cx="240" cy="149" r="2.4" fill="#ffd21f"/>')}
          <g fill="#fff0cf"><circle cx="292" cy="62" r="2.6"/></g>
          ${ship(34, 146, 40, '#6fe3c8', .9)}`;
        break;
      }
      // The orbits tip over and the rounds turn wild: a spark and a bolt over the sun's system.
      case 'mayhem':
        scene = `${orbit(146, 44, -28, '#6fe3c8', '.55')}${orbit(120, 56, 32, '#ffad65', '.5')}${orbit(84, 76, -14, '#bc92ff', '.42')}${sun}
          ${planet(60, 128, 12)}${planet(256, 58, 10, true)}${planet(222, 154, 7)}
          <path d="M20 152C56 134 72 100 104 116s34 50 76 34 70-60 116-84" fill="none" stroke="#ff8660" stroke-width="1.7"/>
          <path d="M26 44C70 60 96 82 122 70s52-40 88-24 56 34 84 20" fill="none" stroke="#6fe3c8" stroke-width="1.4" stroke-dasharray="4 5"/>
          <g fill="#ffad65"><path d="m96 30 4 9 10 1-8 6 2 10-8-6-8 6 3-10-8-6 10-1Z"/><path d="m240 128 3 8 9 1-7 5 2 9-7-5-7 5 2-9-7-5 9-1Z"/></g>
          <circle cx="250" cy="30" r="11" fill="#112c3c" stroke="#6fe3c8"/><path d="m252 21-8 11h6l-2 8 9-12h-6Z" fill="#6fe3c8"/>
          ${ship(20, 152, 62, '#ffad65', .85)}${ship(296, 66, -112, '#6fe3c8', .8)}`;
        break;
    }
  } else if (treatment?.mode === 'horizon') {
    const hole = singularity(160, 100, 25);
    switch (treatment.preset) {
      case 'standard':
        scene = `${orbit(132, 48, -22, '#90c5cf', '.22')}${planet(62, 63, 9)}${planet(274, 144, 10, true)}
          <path d="M22 151C68 169 106 146 124 118S146 77 170 79s46 19 73-7 29-34 48-37" fill="none" stroke="#6fe3c8" stroke-width="1.8"/>
          <path d="M23 151C68 169 106 146 124 118" fill="none" stroke="#6fe3c8" stroke-width="5" opacity=".1"/>
          ${ship(27, 152, 72, '#6fe3c8', .9)}${hole}
          <circle cx="291" cy="34" r="5" fill="#ffad65"/><circle cx="291" cy="34" r="12" fill="none" stroke="#ffad65" stroke-opacity=".38"/>`;
        break;
      case 'trickshot':
        scene = `${orbit(130, 45, -22, '#90c5cf', '.2')}${planet(78, 126, 10)}${planet(253, 56, 8, true)}
          <path d="M20 151Q76 165 113 126T151 96Q173 74 198 88L289 34 289 149Q258 165 223 135" fill="none" stroke="#6fe3c8" stroke-width="1.8"/>
          ${ship(23, 151, 73, '#e8e4d8', .9)}${hole}
          <path d="M289 19v136" stroke="#ffad65" stroke-width="2" opacity=".7"/><path d="m282 31 7 5 7-5m-14 108 7 5 7-5" fill="none" stroke="#ffad65" stroke-width="1.5"/>
          <path d="m289 27 6 7-6 7-6-7Z" fill="#fff0cf"/>`;
        break;
    }
  } else if (treatment?.mode === 'mayhem') {
    switch (treatment.preset) {
      case 'wildClassic':
        scene = `${orbit(145, 61, -17, '#6fe3c8', '.5')}${orbit(105, 44, 29, '#ffad65', '.48')}
          ${planet(157, 96, 25, true)}${planet(58, 133, 11)}${planet(265, 53, 9)}
          <path d="M18 154C53 139 68 97 103 113s48 55 83 29 58-64 112-80" fill="none" stroke="#6fe3c8" stroke-width="1.7"/>
          <path d="M18 154C53 139 68 97 103 113" fill="none" stroke="#6fe3c8" stroke-width="5" opacity=".12"/>
          <path d="M28 47C71 61 92 87 118 79s57-37 93-21 54 34 80 22" fill="none" stroke="#ff8660" stroke-width="1.5" stroke-dasharray="4 5"/>
          ${ship(21, 154, 62, '#6fe3c8', .9)}${ship(297, 62, -112, '#ffad65', .85)}
          <path d="m218 33 4 9 10 1-8 6 2 10-8-6-8 6 3-10-8-6 10-1Z" fill="#ffad65"/>`;
        break;
      case 'insaneHorizon':
        scene = `${orbit(148, 61, -27, '#90c5cf', '.3')}${orbit(120, 42, 30, '#ff8660', '.48')}${orbit(84, 80, -13, '#bc92ff', '.4')}
          <path d="M17 149C72 169 100 139 119 116S137 79 163 74 199 89 204 108 179 139 157 125 143 92 162 82 207 71 296 37" fill="none" stroke="#ff8660" stroke-width="1.8"/>
          <path d="M21 43Q79 22 111 57T153 78 187 118 236 147 300 128" fill="none" stroke="#6fe3c8" stroke-width="1.6" stroke-dasharray="3 4"/>
          ${singularity(160, 100, 24)}${planet(49, 63, 9)}${planet(265, 151, 8, true)}
          ${ship(17, 149, 68, '#ff8660', .82)}${ship(296, 37, -120, '#6fe3c8', .8)}
          <circle cx="233" cy="43" r="9" fill="#132f3c" stroke="#6fe3c8"/><path d="m234 36-5 8h4l-1 6 6-9h-4Z" fill="#6fe3c8"/>
          <path d="m75 107 3 7 8 1-6 5 2 8-7-4-6 4 1-8-6-5 8-1Z" fill="#ffad65"/>`;
        break;
    }
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 320 196');
  svg.setAttribute('class', 'mode-art');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `${art.defs}${art.glow}${stars}${scene}`;
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
