import { AVATAR_PATHS, type Avatar } from '../../platform/avatars';
import { EMBLEM_PATHS, EMBLEMS, type Emblem } from '../../platform/emblems';
import { type Key } from '../../platform/i18n';
import { h } from '../menu/menu';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const AVATAR_LABEL: Record<Avatar, Key> = {
  rocket: 'avatar.rocket',
  satellite: 'avatar.satellite',
  alien: 'avatar.alien',
  robot: 'avatar.robot',
  astronaut: 'avatar.astronaut',
  crosshair: 'avatar.crosshair',
  bolt: 'avatar.bolt',
  gem: 'avatar.gem',
  heart: 'avatar.heart',
  ghost: 'avatar.ghost',
  skull: 'avatar.skull',
  cat: 'avatar.cat',
  paw: 'avatar.paw',
  leaf: 'avatar.leaf',
  drop: 'avatar.drop',
  clover: 'avatar.clover',
  dice: 'avatar.dice',
  note: 'avatar.note',
  eye: 'avatar.eye',
  mushroom: 'avatar.mushroom',
  fish: 'avatar.fish',
  gamepad: 'avatar.gamepad',
  pawn: 'avatar.pawn',
  smile: 'avatar.smile',
};

/** The label of each team emblem. */
export const EMBLEM_LABEL = Object.fromEntries(EMBLEMS.map((e) => [e, `emblem.${e}`])) as Record<Emblem, Key>;

/** A symbol as an SVG, in the colour around it. All its shapes form one path, so the cut-outs are holes. */
export function avatarSvg(avatar: Avatar): SVGSVGElement {
  return pathSvg(AVATAR_PATHS[avatar]);
}

/** A team's emblem as an SVG, in the colour around it. */
export function emblemSvg(emblem: Emblem): SVGSVGElement {
  return pathSvg(EMBLEM_PATHS[emblem]);
}

function pathSvg(shapes: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', shapes.join(' '));
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  svg.append(path);
  return svg;
}

/** A player's symbol in the player's colour, as it shows in the lobby. */
export function playerIcon(avatar: Avatar, color: string): HTMLElement {
  const icon = h('span.player-icon', null, avatarSvg(avatar));
  icon.style.setProperty('--tone', color);
  return icon;
}
