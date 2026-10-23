import { t } from '../i18n';
import type { HandpickedPreset } from './match-presets';
import './pick-of-day.css';

export const pickName = (pick: HandpickedPreset): string => t(`preset.pick.${pick.id}`);
export const pickHint = (pick: HandpickedPreset): string => t(`preset.pick.${pick.mode}.${pick.id}`);

/** Four miniature flight charts, with a singularity or chaotic orbits for the relevant mode. */
export function pickArt(pick: HandpickedPreset): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 320 196');
  svg.setAttribute('class', 'mode-art');
  svg.setAttribute('aria-hidden', 'true');
  const colors = { express: '#6fe3c8', ghost: '#bba6f1', garden: '#9cc9bd', supernova: '#ffad65' };
  const color = colors[pick.id];
  const planet = (x: number, y: number, r: number) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#183246" stroke="${color}" stroke-opacity=".65"/><path d="M${x-r*.6} ${y-r*.2}q${r*.2} ${-r*.7} ${r*.8} ${-r*.4}" fill="none" stroke="${color}" stroke-opacity=".4"/>`;
  const ship = (x: number, y: number, rotate: number) => `<path d="M0-10 6 7 0 3-6 7Z" transform="translate(${x} ${y}) rotate(${rotate})" fill="${color}"/>`;
  const core = pick.base === 'horizon'
    ? '<ellipse cx="160" cy="98" rx="62" ry="19" transform="rotate(-25 160 98)" fill="none" stroke="#eac796" stroke-width="2"/><circle cx="160" cy="98" r="27" fill="#020711" stroke="#b1ccd8"/>'
    : planet(160, 98, pick.id === 'garden' ? 22 : 30);
  const scenes = {
    express: `<path d="M22 142Q83 150 120 89T285 49M29 160Q97 163 131 105" fill="none" stroke="${color}" stroke-width="2"/>${ship(29, 142, 65)}${ship(282, 49, -120)}<path d="m57 59 14-9-3 17m12-20 14-9-3 17" fill="none" stroke="${color}" stroke-width="2"/>`,
    ghost: `<ellipse cx="160" cy="98" rx="106" ry="61" fill="none" stroke="${color}" stroke-dasharray="2 8"/><path d="M28 146Q95 165 115 103T281 54" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="24 4 12 6 4 9 2 12"/>${ship(28, 146, 65)}<circle cx="269" cy="58" r="16" fill="none" stroke="${color}" stroke-opacity=".5"/><path d="M269 35v12m0 22v12m-24-23h12m24 0h12" stroke="${color}"/>`,
    garden: `${planet(72, 57, 13)}${planet(251, 137, 17)}${planet(109, 151, 9)}${planet(245, 46, 10)}<path d="M19 129Q54 182 80 114T149 70 206 106 302 58" fill="none" stroke="${color}" stroke-width="2"/>${ship(19, 129, -15)}<path d="m264 76 7 4v9l-7 6-7-6v-9Z" fill="none" stroke="#ffad65"/>`,
    supernova: `<g fill="none" stroke="${color}"><path d="M22 46Q74 40 119 91T285 156M28 156Q95 159 127 109T289 38" stroke-width="2"/><ellipse cx="160" cy="98" rx="115" ry="44" transform="rotate(-27 160 98)" stroke-opacity=".45"/><path d="m223 52 4 10 11 1-9 7 3 11-9-6-9 6 3-11-9-7 11-1Z"/></g>${ship(22, 46, 105)}${ship(28, 156, 60)}${ship(289, 38, -130)}${planet(68, 101, 10)}`,
  };
  svg.innerHTML = `<g fill="#e8e4d8" opacity=".4"><circle cx="32" cy="25" r="1"/><circle cx="107" cy="33" r="1.5"/><circle cx="281" cy="99" r="1"/><circle cx="190" cy="169" r="1"/><circle cx="65" cy="176" r="1"/></g><ellipse cx="160" cy="98" rx="136" ry="69" fill="none" stroke="${color}" stroke-opacity=".12"/>${pick.mode === 'mayhem' ? `<ellipse cx="160" cy="98" rx="135" ry="48" transform="rotate(32 160 98)" fill="none" stroke="#ff8660" stroke-dasharray="4 9" stroke-opacity=".6"/>` : ''}${scenes[pick.id]}${core}`;
  return svg;
}

