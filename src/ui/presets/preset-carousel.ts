import { t } from '../../platform/i18n';
import { h } from '../menu/menu';

/** Native horizontal scrolling on phones; swiping browses, tapping a card applies its rules. */
export function presetCarousel(cards: HTMLElement) {
  const narrow = matchMedia('(max-width: 760px)');
  const previous = h('button.preset-carousel__arrow', { type: 'button', 'aria-label': t('preset.previous') }, '‹') as HTMLButtonElement;
  const next = h('button.preset-carousel__arrow', { type: 'button', 'aria-label': t('preset.next') }, '›') as HTMLButtonElement;
  const counter = h('span.preset-carousel__count', { 'aria-live': 'polite', 'aria-atomic': 'true' });
  const navigation = h('nav.preset-carousel__nav', { 'aria-label': t('preset.choose') }, previous, counter, next);
  const listeners = new AbortController();
  let frame = 0;
  let selected: Element | null = null;
  const leftOf = (slide: HTMLElement) => slide.getBoundingClientRect().left - cards.getBoundingClientRect().left + cards.scrollLeft;
  const slides = () => Array.from(cards.querySelectorAll<HTMLElement>(':scope > .briefing__preset-shell, :scope > .item--card, :scope > .briefing__own > *')).sort((a, b) => leftOf(a) - leftOf(b));
  const nearest = (all: HTMLElement[]) => all.reduce((best, slide, index) => Math.abs(leftOf(slide) - cards.scrollLeft) < Math.abs(leftOf(all[best]) - cards.scrollLeft) ? index : best, 0);
  const move = (direction: number) => {
    const all = slides();
    if (!all.length) return;
    const index = Math.max(0, Math.min(all.length - 1, nearest(all) + direction));
    cards.scrollTo({ left: leftOf(all[index]), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  const update = () => {
    frame = 0;
    navigation.hidden = !narrow.matches;
    if (!narrow.matches || !cards.isConnected) return;
    const all = slides();
    if (!all.length) return;
    const chosen = cards.querySelector('[aria-pressed="true"]');
    // Reopening a briefing or choosing a preset brings its card back into view, without applying a rule on scroll.
    if (chosen !== selected) {
      selected = chosen;
      const slide = all.find((el) => el === chosen || (chosen && el.contains(chosen)));
      if (slide) cards.scrollLeft = leftOf(slide);
    }
    const index = nearest(all);
    counter.textContent = t('preset.position', { n: index + 1, total: all.length });
    previous.disabled = index === 0;
    next.disabled = index === all.length - 1;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  previous.addEventListener('click', () => move(-1), { signal: listeners.signal });
  next.addEventListener('click', () => move(1), { signal: listeners.signal });
  cards.addEventListener('scroll', schedule, { passive: true, signal: listeners.signal });
  const observer = new MutationObserver(schedule);
  observer.observe(cards, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
  const size = new ResizeObserver(schedule);
  size.observe(cards);
  narrow.addEventListener('change', schedule);
  schedule();
  return {
    navigation,
    dispose: () => {
      listeners.abort();
      observer.disconnect();
      size.disconnect();
      narrow.removeEventListener('change', schedule);
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
