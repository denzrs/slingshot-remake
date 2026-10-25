import { AVATAR_PATHS, type Avatar } from '../../platform/avatars';
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
};

/** A symbol as an SVG, in the colour around it. All its shapes form one path, so the cut-outs are holes. */
export function avatarSvg(avatar: Avatar): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', AVATAR_PATHS[avatar].join(' '));
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
