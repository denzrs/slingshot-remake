import { h } from './dom';
import { modeArt, type ModeArt } from './mode-icons';

/** A complete, named next step, using the same visual language as local mode selection. */
export function flightCard(title: string, hint: string, art: ModeArt, run: () => void): HTMLButtonElement {
  const el = h('button.flight-card', { type: 'button' },
    h('span.flight-card__art', null, modeArt(art)),
    h('span.flight-card__title', null, title),
    h('span.flight-card__hint', null, hint),
    h('span.flight-card__arrow', { 'aria-hidden': 'true' }, '↗'),
  ) as HTMLButtonElement;
  el.addEventListener('click', run);
  return el;
}
