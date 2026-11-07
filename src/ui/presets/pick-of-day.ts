import { t, type Key } from '../../platform/i18n';
import type { HandpickedId, HandpickedPreset } from './match-presets';
import { nextSpaceArtId, spaceArt } from '../menu/space-art';
import './pick-of-day.css';

export const pickName = (pick: HandpickedPreset): string => t(`preset.pick.${pick.id}`);
// Preset creation guarantees valid mode/id pairs, though the interface stores them as separate unions.
export const pickHint = (pick: HandpickedPreset): string => t(`preset.pick.${pick.mode}.${pick.id}` as Key);

const COLORS: Record<HandpickedId, string> = {
  pinballRiot: '#ffad65',
  blindSonar: '#8edbff',
  siegeRun: '#ff806e',
  spacetimeRift: '#bba6f1',
  nebulaLock: '#c29aff',
  singlePlanetMayhem: '#ff7166',
  orbitalSniper: '#6fe3c8',
  solarSailer: '#f2c46d',
  eclipseRicochet: '#a5cdff',
  totalEclipse: '#ff8660',
  cosmicMaelstrom: '#d29bff',
  hyperOrbit: '#ffad65',
  escapeVelocity: '#6fe3c8',
  horizonShadow: '#8ec3df',
  gravityCentrifuge: '#f4a47c',
  planetEater: '#e28b7c',
  singularityBlitz: '#c5a4ff',
  deathSpiral: '#ff7466',
  bubbleWrap: '#6fe3c8',
  hostileArchitecture: '#ff806e',
  noForwardingAddress: '#8ec3df',
  theUnlearning: '#c29aff',
};

/** Original flight chart for each authored daily combination. */
export function pickArt(pick: HandpickedPreset): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 320 196');
  svg.setAttribute('class', 'mode-art');
  svg.setAttribute('aria-hidden', 'true');

  const art = spaceArt(nextSpaceArtId('pick'));
  const c = COLORS[pick.id];
  const line = (d: string, width = 2, dash = '') => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  const planet = (x: number, y: number, r: number, ghost = false, warm = false) => art.planet(x, y, r, warm, ghost);
  const ship = (x: number, y: number, angle: number, color = c, scale = .78) => art.ship(x, y, angle, color, scale);
  const portal = (x: number, y: number, rx = 9, ry = 17) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${c}" fill-opacity=".1" stroke="${c}" stroke-width="2"/><ellipse cx="${x}" cy="${y}" rx="${rx - 3}" ry="${ry - 5}" fill="none" stroke="${c}" stroke-opacity=".45"/>`;
  const cannon = (x: number, y: number, angle: number) => `<g transform="translate(${x} ${y}) rotate(${angle})"><circle r="7" fill="#183246" stroke="${c}"/><path d="M0-4v-13" stroke="${c}" stroke-width="3" stroke-linecap="round"/><path d="M-5 4 0 1 5 4" fill="none" stroke="${c}" stroke-width="1.5"/></g>`;
  const cloud = (x: number, y: number, rx: number, ry: number) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${c}" fill-opacity=".11" stroke="${c}" stroke-opacity=".6" stroke-dasharray="4 5"/><ellipse cx="${x}" cy="${y}" rx="${rx * .65}" ry="${ry * .55}" fill="none" stroke="${c}" stroke-opacity=".28"/>`;

  const trace = (d: string, width = 2, dash = '', color = c, opacity = 1) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  const spark = (x: number, y: number, color = '#ffe4a7') => `<g transform="translate(${x} ${y})" stroke="${color}" stroke-width="1.5"><path d="M-7 0H7M0-7V7m-4-4 8 8m0-8-8 8"/><circle r="2.5" fill="${color}"/></g>`;

  const scenes: Record<HandpickedId, string> = {
    pinballRiot: `${line('M25 44 295 44 295 150 25 150 25 44', 1.5, '5 7')}${planet(92, 82, 13)}${planet(229, 120, 16)}${line('M30 126Q68 162 86 110T145 80Q188 64 214 102T289 60')}${line('M35 65Q72 33 102 79T175 130Q226 155 282 92', 1.4)}${ship(30, 126, 45)}${ship(289, 60, -118)}`,
    blindSonar: `${planet(86, 67, 15, true)}${planet(230, 83, 18, true)}${planet(173, 143, 13, true)}<circle cx="81" cy="111" r="25" fill="none" stroke="${c}" stroke-opacity=".35"/><circle cx="81" cy="111" r="44" fill="none" stroke="${c}" stroke-opacity=".2"/><path d="M81 111 128 78" stroke="${c}" stroke-width="2"/>${line('M22 161Q68 154 111 89T209 93 294 51', 2.2, '17 5 3 6')}${ship(22, 161, -18)}`,
    siegeRun: `${planet(75, 66, 16)}${planet(247, 129, 17)}${planet(179, 58, 11)}${cannon(75, 66, -45)}${cannon(247, 129, 118)}<path d="M34 127Q89 95 127 122T206 106 286 70" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="2 5"/><path d="m123 88 14 14m0-14-14 14M206 143l14 14m0-14-14 14" stroke="${c}" stroke-width="2"/>${ship(34, 127, -55)}`,
    spacetimeRift: `${portal(74, 123, 12, 20)}${portal(245, 64, 12, 20)}${art.singularity(169, 95, 17)}${line('M28 57Q84 42 97 111T183 137Q222 138 242 79T291 143')}${line('M30 157Q92 172 115 97T228 54', 1.2, '3 6')}${ship(28, 57, 78)}`,
    nebulaLock: `${cloud(143, 100, 68, 40)}${cloud(235, 72, 37, 24)}${planet(71, 131, 15)}${line('M25 148Q91 131 127 100T203 84 290 46', 3)}${line('M28 154Q95 142 137 112T217 93', 1, '2 6')}<circle cx="140" cy="101" r="4" fill="#d9fbff"/>${ship(25, 148, -35)}`,
    singlePlanetMayhem: `${planet(160, 100, 21)}${line('M31 45Q83 15 124 70T199 132Q241 165 288 116', 2.5)}${line('M31 150Q88 177 126 123T202 64Q247 28 289 70', 2, '5 5')}<path d="M160 59v-17m0 116v-17m-41-41h-17m116 0h-17" stroke="${c}" stroke-opacity=".7"/>${ship(31, 45, 50)}${ship(289, 70, -125)}`,
    orbitalSniper: `${planet(83, 64, 14)}${planet(249, 132, 18)}${cannon(83, 64, 155)}<ellipse cx="160" cy="98" rx="116" ry="55" fill="none" stroke="${c}" stroke-opacity=".25"/><path d="M97 67Q157 38 211 82" fill="none" stroke="${c}" stroke-width="1.5" stroke-dasharray="3 5"/><path d="M99 68 240 126" stroke="${c}" stroke-opacity=".7" stroke-dasharray="4 4"/>${ship(222, 120, -165)}`,
    solarSailer: `${cloud(113, 96, 42, 29)}${cloud(214, 105, 39, 25)}${planet(70, 132, 12)}${planet(260, 59, 13, false, true)}<path d="M26 157Q73 154 87 111T138 67Q182 43 207 91T291 54" fill="none" stroke="${c}" stroke-width="2.5"/><path d="M29 167Q77 166 95 121T145 76" fill="none" stroke="${c}" stroke-width="1" stroke-opacity=".35"/>${ship(26, 157, -38)}`,
    eclipseRicochet: `${portal(68, 98, 8, 14)}${portal(255, 103, 8, 14)}${planet(139, 58, 12)}${planet(199, 143, 16)}${line('M21 39 299 39 299 158 21 158 21 39', 1.4, '4 7')}${line('M25 141Q75 136 73 88T136 51Q187 38 217 86T292 55')}${ship(25, 141, -12)}`,
    totalEclipse: `<ellipse cx="160" cy="98" rx="122" ry="61" fill="none" stroke="${c}" stroke-opacity=".3" stroke-dasharray="2 7"/><ellipse cx="160" cy="98" rx="82" ry="40" fill="none" stroke="${c}" stroke-opacity=".2" stroke-dasharray="2 6"/>${planet(53, 101, 11, true)}${planet(247, 89, 15, true)}${planet(147, 42, 9, true)}${line('M25 152Q78 166 120 118T208 75 293 49', 2, '22 4 2 8')}${ship(25, 152, -26)}`,
    cosmicMaelstrom: `${planet(83, 61, 12)}${art.singularity(206, 104, 22, 31)}<ellipse cx="160" cy="98" rx="124" ry="57" fill="none" stroke="${c}" stroke-opacity=".22"/><path d="M31 144Q91 166 126 105T178 78Q227 67 285 124" fill="none" stroke="${c}" stroke-width="2"/>${ship(31, 144, -18)}`,
    hyperOrbit: `${line('M20 43 300 43 300 153 20 153 20 43', 1.3, '5 6')}${planet(91, 70, 12)}${planet(234, 130, 15)}${line('M22 135Q48 50 111 54T187 140Q217 169 268 99T295 61', 3)}${line('M27 160Q62 89 112 91T188 56Q233 37 291 94', 1.2, '8 4')}${ship(22, 135, -70)}<path d="m57 52 13 4-11 8m192 67 13 4-11 8" fill="none" stroke="${c}"/>`,
    escapeVelocity: `${line('M24 154Q115 178 139 121T180 75Q207 39 239 62T276 109')}${line('M34 144Q111 153 142 116T185 83', 1.2, '3 6')}<ellipse cx="164" cy="98" rx="59" ry="24" transform="rotate(-23 164 98)" fill="none" stroke="${c}" stroke-opacity=".42"/>${planet(91, 66, 12)}${planet(238, 139, 13)}${ship(24, 154, -35)}`,
    horizonShadow: `${portal(65, 128, 9, 18)}${portal(256, 62, 9, 18)}<ellipse cx="160" cy="98" rx="77" ry="29" transform="rotate(-25 160 98)" fill="none" stroke="${c}" stroke-opacity=".36" stroke-dasharray="2 7"/>${line('M28 50Q90 47 98 115T171 131Q221 140 250 78T291 149', 2, '15 5 2 8')}${ship(28, 50, 75)}`,
    gravityCentrifuge: `${planet(81, 66, 13)}${planet(244, 125, 14)}<ellipse cx="160" cy="98" rx="114" ry="54" fill="none" stroke="${c}" stroke-opacity=".28"/><ellipse cx="160" cy="98" rx="76" ry="34" transform="rotate(-18 160 98)" fill="none" stroke="${c}" stroke-opacity=".48"/><path d="M47 120Q79 158 111 126T149 82Q173 53 205 75T273 103" fill="none" stroke="${c}" stroke-width="2.5"/><path d="M160 36v18m0 88v18m-106-62h20m172 0h20" stroke="${c}" stroke-width="1.5"/>${ship(47, 120, 39)}`,
    planetEater: `${planet(68, 56, 13)}${planet(251, 58, 16, false, true)}${planet(66, 146, 11)}${planet(259, 144, 12, false, true)}${line('M80 63Q121 80 143 91M239 65Q205 83 180 92M78 139Q116 119 142 106M246 135Q204 114 180 105', 1.5, '4 5')}`,
    singularityBlitz: `${planet(84, 119, 15)}<path d="M24 38 296 38 296 158 24 158 24 38" fill="none" stroke="${c}" stroke-opacity=".3" stroke-dasharray="4 6"/><path d="M86 120Q110 141 143 114T175 78Q213 55 268 85" fill="none" stroke="${c}" stroke-width="2.5"/>${ship(268, 85, -110)}`,
    deathSpiral: `${planet(68, 56, 12)}${planet(250, 62, 13, false, true)}${planet(246, 144, 11)}<path d="M37 131Q71 156 102 127T126 86Q139 48 180 59T218 101Q216 131 181 132Q150 132 151 104Q152 82 174 84Q190 86 186 101" fill="none" stroke="${c}" stroke-width="2.3"/><path d="M30 155Q71 176 110 143T130 87" fill="none" stroke="${c}" stroke-opacity=".45" stroke-dasharray="3 6"/>${ship(37, 131, 22)}`,
    bubbleWrap: `${trace('M20 36H300V162H20', 1, '4 7', '#ffad65', .32)}
      ${art.planet(95, 62, 17)}${art.planet(259, 147, 10, true)}
      <circle cx="220" cy="96" r="34" fill="${c}" fill-opacity=".05" stroke="${c}" stroke-width="1.7"/>
      <path d="M196 72A34 34 0 0 1 243 72" fill="none" stroke="#b9ffea" stroke-width="3" opacity=".6"/>
      ${trace('M29 144Q58 154 84 130', 2.3, '', '#ffad65')}
      ${trace('M84 130Q119 111 150 71T237 48L283 36 298 63', 1.8, '', '#ffad65')}
      ${trace('M84 130Q139 143 186 100Q164 82 154 57', 2, '', '#ffad65')}
      ${trace('M84 130Q133 169 188 151T274 112', 1.8, '', '#ffad65')}
      <circle cx="84" cy="130" r="3" fill="#ffe4a7"/>${spark(186, 100)}
      ${ship(29, 144, 73, '#ffad65')}${ship(220, 96, -70)}`,
    hostileArchitecture: `${art.planet(74, 59, 12)}${art.planet(262, 144, 16, true)}${art.planet(220, 49, 9)}
      ${art.planet(137, 113, 28)}
      <g fill="none" stroke="${c}"><circle cx="133" cy="85" r="42" stroke-opacity=".17" stroke-dasharray="3 5"/><circle cx="133" cy="85" r="29" stroke-opacity=".3"/><circle cx="133" cy="85" r="16" fill="${c}" fill-opacity=".07" stroke-opacity=".55"/></g>
      <g transform="translate(133 85) rotate(22)"><circle r="7" fill="#183246" stroke="${c}"/><path d="M0-4v-15" stroke="${c}" stroke-width="3" stroke-linecap="round"/><path d="M-6 5 0 1 6 5" fill="none" stroke="${c}" stroke-width="1.5"/></g>
      ${trace('M281 74 158 104', 1.5, '5 5')}${trace('M281 74 158 104', 5, '', c, .1)}
      ${trace('m151 91-10 16 8 8-14 12 3 13', 2.2, '', '#ffad65')}
      ${trace('m166 112 8 2m-9 13 7 6m-20 13 2 6', 1.6, '', '#ffad65')}
      ${spark(158, 104)}${ship(281, 74, -104)}
      ${trace('M44 155Q75 162 91 130T109 91', 1.5, '3 5', '#6fe3c8')}`,
    noForwardingAddress: `${art.singularity(160, 98, 27)}${art.planet(246, 144, 12)}
      <ellipse cx="160" cy="98" rx="110" ry="57" fill="none" stroke="${c}" stroke-opacity=".14"/>
      <g opacity=".35" fill="none" stroke="${c}" stroke-dasharray="2 3"><path d="M60 125 72 140 63 139 58 148Z"/><circle cx="63" cy="137" r="20"/></g>
      ${trace('M24 69Q48 85 63 137', 1.7, '', '#ffad65')}${spark(63, 137, '#ffad65')}
      ${trace('M81 126Q90 107 102 93', 1.2, '2 8', c, .25)}
      ${trace('M210 68Q221 55 239 52', 1.2, '2 7', c, .45)}
      <circle cx="257" cy="57" r="21" fill="${c}" fill-opacity=".035" stroke="${c}" stroke-opacity=".6"/>
      <path d="M239 48a21 21 0 0 1 24-11m10 30a21 21 0 0 1-24 11" fill="none" stroke="${c}" stroke-width="2"/>
      ${ship(257, 57, 60)}
      <g fill="${c}" opacity=".55"><circle cx="237" cy="78" r="1.6"/><circle cx="230" cy="82" r="1"/><circle cx="223" cy="86" r=".7"/></g>`,
    theUnlearning: `<g fill="none" stroke="#f2c46d" stroke-opacity=".2"><ellipse cx="160" cy="98" rx="62" ry="34"/><ellipse cx="160" cy="98" rx="112" ry="60"/></g>
      ${art.sun(160, 98)}${art.planet(229, 62, 15)}${art.planet(112, 147, 11)}
      <circle cx="229" cy="62" r="21" fill="none" stroke="${c}" stroke-opacity=".75" stroke-dasharray="3 4"/>
      <g fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M229 35V23m-4 5 4-5 4 5M256 62h12m-5-4 5 4-5 4M246 80l9 9m-7 0h7v-7"/></g>
      ${trace('M29 149Q65 166 89 115T151 44Q174 29 190 49', 2, '', '#6fe3c8')}
      ${trace('M190 49Q201 64 204 81', 1.2, '3 5', '#6fe3c8', .25)}
      ${trace('M190 49Q192 31 213 23T290 29', 2, '', '#6fe3c8')}
      ${trace('m280 24 10 5-11 2', 1.6, '', '#6fe3c8')}
      ${ship(29, 149, 70, '#6fe3c8')}${ship(278, 138, -85, c, .7)}`,
  };

  const background = '<g fill="#e8e4d8" opacity=".4"><circle cx="32" cy="25" r="1"/><circle cx="107" cy="33" r="1.5"/><circle cx="281" cy="99" r="1"/><circle cx="190" cy="169" r="1"/><circle cx="65" cy="176" r="1"/></g>';
  // Scenes with their own field already include any sun, singularity or open space they need.
  const hasOwnField = ['bubbleWrap', 'hostileArchitecture', 'noForwardingAddress', 'theUnlearning'].includes(pick.id);
  const modeField = hasOwnField ? '' : pick.mode === 'horizon'
    ? art.singularity(160, 98, 27)
    : pick.mode === 'solar'
      ? `<g fill="none" stroke="#f2c46d" stroke-opacity=".23"><ellipse cx="160" cy="98" rx="62" ry="34"/><ellipse cx="160" cy="98" rx="104" ry="56"/></g>${art.sun(160, 98)}`
      : '<ellipse cx="160" cy="98" rx="110" ry="58" fill="none" stroke="#b4c8d4" stroke-opacity=".14"/>';
  const mayhem = pick.rules.mayhem > 0
    ? '<ellipse cx="160" cy="98" rx="135" ry="48" transform="rotate(32 160 98)" fill="none" stroke="#ff8660" stroke-dasharray="4 9" stroke-opacity=".65"/>'
    : '';
  svg.innerHTML = `${art.defs}${art.glow}${background}${modeField}${mayhem}<g>${scenes[pick.id]}</g>`;
  return svg;
}
