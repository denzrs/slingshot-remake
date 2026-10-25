import type { Match } from '../../game';
import { awardLabel, awardValue, awardWho } from '../../game/scorecard';
import type { Award } from '../../data/stats';
import { t } from '../../platform/i18n';
import { h } from '../dom';

/** How long a highlight stays up before the reel moves on by itself, in milliseconds. */
const REEL_EVERY = 5200;
/** A sideways swipe at least this long (and flatter than it is wide) turns the reel. */
const SWIPE = 40;

/** One highlight: its saved shot path (when it has one) and who set the record, with the value. */
function momentSlide(match: Match, award: Award): { slide: HTMLElement; color: string } {
  const who = awardWho(match, award);
  const name = h('span.result-spotlight__who', null, who.name);
  name.style.color = who.color;
  const hasTrail = !!award.trail && award.trail.length >= 4;
  const slide = h('div.result-spotlight__slide', null,
    ...(hasTrail ? [matchShotTrail(award, who.color, `${awardLabel(award.kind)} · ${who.name}`, true)] : []),
    h('div.result-spotlight__caption', null,
      h('div', null, h('p.result-spotlight__label', null, awardLabel(award.kind)), name),
      h('p.result-spotlight__value', null, awardValue(award)),
    ),
  );
  if (!hasTrail) slide.classList.add('result-spotlight__slide--number');
  return { slide, color: who.color };
}

/**
 * The match's highlights on one card. With more than one it flips through them on its own, with arrows and dots to take
 * over; the first touch, click or key press stops the automatic turning for good.
 */
export function matchMomentReel(match: Match, moments: readonly Award[]): { element: HTMLElement; dispose: () => void } {
  const count = moments.length;
  const stage = h('div.result-spotlight__stage', null);
  const card = h('section.result-spotlight', null, h('h3.ranking-label', null, t('over.spotlight')), stage);
  let index = 0;
  let timer = 0;
  const dots: HTMLButtonElement[] = [];

  const show = (next: number, animate: boolean): void => {
    index = (next + count) % count;
    const { slide, color } = momentSlide(match, moments[index]);
    if (animate) slide.classList.add('is-entering');
    stage.replaceChildren(slide);
    card.style.setProperty('--record', color);
    dots.forEach((dot, i) => {
      dot.classList.toggle('is-active', i === index);
      if (i === index) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  };

  if (count < 2) {
    show(0, false);
    return { element: card, dispose: () => {} };
  }

  const stop = (): void => {
    window.clearTimeout(timer);
    timer = 0;
  };
  const schedule = (): void => {
    timer = window.setTimeout(() => {
      show(index + 1, true);
      schedule();
    }, REEL_EVERY);
  };
  /** The player takes over: turn the reel by hand and leave it there. */
  const go = (step: number): void => {
    stop();
    show(index + step, true);
  };

  const button = (cls: string, label: string, run: () => void): HTMLButtonElement => {
    const el = h(`button.${cls}`, { type: 'button', 'aria-label': label }) as HTMLButtonElement;
    el.addEventListener('click', run);
    return el;
  };
  const prev = button('result-spotlight__arrow.result-spotlight__arrow--prev', t('over.spotlightPrev'), () => go(-1));
  const next = button('result-spotlight__arrow.result-spotlight__arrow--next', t('over.spotlightNext'), () => go(1));
  moments.forEach((_, i) => {
    dots.push(button('result-spotlight__dot', t('over.spotlightOf', { n: i + 1, total: count }), () => { stop(); show(i, true); }));
  });
  card.querySelector('.ranking-label')!.after(h('div.result-spotlight__nav', null, prev, h('div.result-spotlight__dots', null, ...dots), next));

  // Any other way of touching the card counts as taking over, too.
  card.addEventListener('pointerdown', stop);
  card.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    stop();
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    go(event.key === 'ArrowRight' ? 1 : -1);
  });
  let swipe: { x: number; y: number } | null = null;
  card.addEventListener('touchstart', (event) => {
    swipe = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
  }, { passive: true });
  card.addEventListener('touchend', (event) => {
    const from = swipe;
    swipe = null;
    if (!from || event.changedTouches.length !== 1) return;
    const dx = event.changedTouches[0].clientX - from.x;
    const dy = event.changedTouches[0].clientY - from.y;
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    go(dx < 0 ? 1 : -1);
  }, { passive: true });

  show(0, false);
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) schedule();
  return { element: card, dispose: stop };
}

/** The match record's saved path, drawn across as a small, replay-like trajectory highlight. */
export function matchShotTrail(award: Award, color: string, label: string, featured = false): SVGSVGElement {
  const points = award.trail!;
  const size = featured ? 640 : 320;
  const height = featured ? 270 : 100;
  const pad = featured ? 30 : 12;
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((size - pad * 2) / spanX, (height - pad * 2) / spanY);
  const project = (x: number, y: number): [number, number] => [
    (size - spanX * scale) / 2 + (x - minX) * scale,
    (height + spanY * scale) / 2 - (y - minY) * scale,
  ];
  const point = (i: number) => project(points[i], points[i + 1]);
  const pathData = Array.from({ length: points.length / 2 }, (_, i) => {
    const [x, y] = point(i * 2);
    return `${i ? 'L' : 'M'}${x},${y}`;
  }).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'match-highlight__trail');
  svg.setAttribute('viewBox', `0 0 ${size} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = label;
  svg.append(title);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('class', 'match-highlight__path');
  path.setAttribute('d', pathData);
  path.setAttribute('pathLength', '1');
  path.setAttribute('stroke', color);
  svg.append(path);
  if (award.at) {
    const [x, y] = project(award.at.x, award.at.y);
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    mark.setAttribute('class', 'match-highlight__event');
    mark.setAttribute('cx', String(x));
    mark.setAttribute('cy', String(y));
    mark.setAttribute('r', featured ? '12' : '6');
    mark.setAttribute('stroke', color);
    svg.append(mark);
  }
  const [startX, startY] = point(0);
  if (featured) {
    const [nextX, nextY] = point(2);
    const ship = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const angle = Math.atan2(nextY - startY, nextX - startX) * 180 / Math.PI;
    ship.setAttribute('d', 'M 8 0 L -6 -5 L -3 0 L -6 5 Z');
    ship.setAttribute('transform', `translate(${startX} ${startY}) rotate(${angle})`);
    ship.setAttribute('fill', color);
    svg.append(ship);
  }
  const start = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  start.setAttribute('class', 'match-highlight__start');
  start.setAttribute('cx', String(startX));
  start.setAttribute('cy', String(startY));
  start.setAttribute('r', '2');
  if (!featured) svg.append(start);
  const [endX, endY] = point(points.length - 2);
  const end = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  end.setAttribute('class', 'match-highlight__end');
  end.setAttribute('cx', String(endX));
  end.setAttribute('cy', String(endY));
  end.setAttribute('r', '3');
  end.setAttribute('fill', color);
  svg.append(end);
  return svg;
}
