import { t } from '../../platform/i18n';
import type { Emblem } from '../../platform/emblems';
import type { TournamentMatch, TournamentView } from '../../net/net';
import { h } from '../menu/menu';
import { emblemSvg } from '../room/avatars';
import { lockIcon, textInput } from '../lobby/widgets';
import { stageName } from './setup';
import { stageSummary } from './stage-summary';

/** A team's emblem in its colour, as its members picked them. */
export function teamBadge(team: { emblem: Emblem; color: string }): HTMLElement {
  const badge = h('span.t-badge-icon', { style: `--team: ${team.color}`, 'aria-hidden': 'true' });
  badge.append(emblemSvg(team.emblem));
  return badge;
}

/** What the bracket can ask the page to do, and what the page remembers between drawings. */
export interface BracketContext {
  view: TournamentView;
  /** The team shown in the side panel. */
  selectedTeam: number | null;
  /** The free place a team is being made in. */
  creatingAt: string | null;
  /** Teams already drawn once: a new one comes in with a short animation. */
  seenTeams: Set<number>;
  selectTeam(team: number): void;
  startCreating(slot: string): void;
  cancelCreating(): void;
  createTeam(name: string, closed: boolean, slot: number): void;
  /** Opens a level's dialog: to change it for an organizer while it is open, to look at otherwise. */
  showStage(stage: number): void;
  enter(): void;
  watch(level: number, index: number): void;
  skip(level: number, index: number, team?: number): void;
}

/** One match as the bracket draws it. While teams register, `free` marks the places still open and `places` says which they are. */
interface Card {
  level: number;
  index: number;
  teams: [number | null, number | null];
  free: [boolean, boolean];
  match: TournamentMatch | null;
  /** The places (a team's `slot`) the two rows of a first-level card stand for while teams register. */
  places?: [number, number];
}

/**
 * The order matches stand in down a level of `count` matches, counted from 0 in the order they filled: the seeding of a real cup.
 * Match 0 always stands on the left and match 1 on the right, and as the bracket doubles a match keeps its side; the new ones take
 * turns between the sides.
 */
export function matchOrder(count: number): number[] {
  let order = [0];
  while (order.length < count) {
    const n = order.length * 2;
    order = order.flatMap((match) => [match, n - 1 - match]);
  }
  return order;
}

/** The place the next team takes: the first one free, as the relay gives it to a team that names none. */
function nextPlace(view: TournamentView): number | null {
  if (view.teams.length >= view.settings.maxTeams) return null;
  const taken = new Set(view.teams.map((team) => team.slot));
  let place = 0;
  while (taken.has(place)) place++;
  return place;
}

/**
 * The bracket while teams register: just as big as the teams there need, a bracket they could play as it stands. Teams pair up in
 * the order they came, two to a match, and a match stays together as the bracket grows and never changes sides (`matchOrder`).
 * Who meets whom is drawn only at the start (the relay draws at random); a place left empty then is a bye.
 */
function previewSize(view: TournamentView): number {
  const top = view.teams.reduce((most, team) => Math.max(most, team.slot + 1), 0);
  return 2 ** Math.ceil(Math.log2(Math.max(2, top)));
}

/** Where the next team goes when every place of the bracket is taken: it grows to this size, or null while it has a free place. */
function growsTo(view: TournamentView): number | null {
  if (view.bracket || view.phase !== 'registration') return null;
  const next = nextPlace(view);
  const size = previewSize(view);
  return next === null || next < size ? null : size * 2;
}

/** How many levels the bracket on screen has: the drawn one's, or what the teams so far and the next one would need. */
export function bracketDepth(view: TournamentView): number {
  return view.bracket ? view.bracket.levels.length : Math.log2(previewSize(view));
}

/** How many teams the bracket is for: the drawn one's size, or the one the teams so far would play if it started now. */
export function bracketSize(view: TournamentView): number {
  return 2 ** (view.bracket ? view.bracket.levels.length : Math.max(1, Math.ceil(Math.log2(Math.max(2, view.teams.length)))));
}

function previewCards(view: TournamentView): Card[][] {
  const size = previewSize(view);
  const levels: Card[][] = [];
  for (let level = 0, matches = size / 2; matches >= 1; level++, matches /= 2) {
    levels.push(Array.from({ length: matches }, (_, index): Card => ({ level, index, teams: [null, null], free: [false, false], match: null })));
  }
  const at = (slot: number): number | null => { const found = view.teams.findIndex((team) => team.slot === slot); return found < 0 ? null : found; };
  const order = matchOrder(size / 2);
  const open = (place: number) => place < view.settings.maxTeams;
  levels[0].forEach((card, i) => {
    const places: [number, number] = [2 * order[i], 2 * order[i] + 1];
    card.places = places;
    card.teams = [at(places[0]), at(places[1])];
    card.free = [card.teams[0] === null && open(places[0]), card.teams[1] === null && open(places[1])];
  });
  return levels;
}

function drawnCards(view: TournamentView): Card[][] {
  return view.bracket!.levels.map((matches, level) => matches.map((match, index): Card => ({
    level, index, match, teams: match.teams, free: [false, false],
  })));
}

/** Whether a level's game may still change: nothing of it has been played. */
function stageOpen(view: TournamentView, level: number): boolean {
  if (view.phase === 'registration') return true;
  if (view.phase === 'finished' || !view.bracket) return false;
  return view.bracket.levels[level].every((m) => m.bye || m.state === 'waiting' || m.state === 'ready');
}

function teamRow(ctx: BracketContext, card: Card, side: 0 | 1): HTMLElement {
  const { view } = ctx;
  const team = card.teams[side];
  const registering = view.phase === 'registration';
  if (team === null) {
    const key = `${card.level}-${card.index}-${side}`;
    if (registering && card.free[side]) {
      const slot = card.places?.[side] ?? card.index * 2 + side;
      if (ctx.creatingAt === key) return createRow(ctx, slot);
      // Every free place takes a team; the one the next team gets anyway stands out, the others stay quiet until pointed at.
      const next = slot === nextPlace(view) ? '.is-next' : '';
      const add = h(`button.tb-row.tb-row--free${next}`, { type: 'button', 'data-side': String(side) },
        h('span.tb-row__plus', { 'aria-hidden': 'true' }, '+'), h('span.tb-row__name', null, t('tournament.foundTeam')),
      );
      add.addEventListener('click', () => ctx.startCreating(key));
      return add;
    }
    const bye = card.match?.bye && side === 1;
    return h('div.tb-row.tb-row--empty', { 'data-side': String(side) }, h('span.tb-row__name', null, bye ? t('tournament.bye') : '—'));
  }
  const info = view.teams[team];
  const m = card.match;
  const won = m?.state === 'done' && m.winner === team;
  const lost = m?.state === 'done' && m.winner !== null && m.winner !== team;
  const classes = ['tb-row', won && 'is-winner', lost && 'is-loser', view.you.team === team && 'is-mine', info.withdrawn && 'is-withdrawn',
    !ctx.seenTeams.has(team) && 'is-new', ctx.selectedTeam === team && 'is-selected'].filter(Boolean).join('.');
  const score = m?.score ? String(m.score[side]) : '';
  const row = h(`button.${classes}`, { type: 'button', 'data-side': String(side), title: info.name },
    teamBadge(info),
    h('span.tb-row__name', null, info.name),
    ...(view.bracket?.champion === team && won && card.level === view.bracket.levels.length - 1 ? [crownSvg()] : []),
    ...(info.closed && registering ? [h('span.tb-row__lock', { 'aria-hidden': 'true' }, lockIcon())] : []),
    h('span.tb-row__score', null, registering ? `${info.members.length}/${view.settings.teamSize}` : score),
  );
  row.addEventListener('click', () => ctx.selectTeam(team));
  return row;
}

/** The form that makes a team in a free place: its name, and whether it wants a code. */
function createRow(ctx: BracketContext, slot: number): HTMLElement {
  const name = textInput('', { maxLength: 24, autocomplete: 'off', placeholder: t('tournament.teamNamePlaceholder') });
  name.setAttribute('aria-label', t('tournament.teamName'));
  let closed = false;
  const lock = h('button.tb-create__lock', { type: 'button', 'aria-pressed': 'false', title: t('tournament.closedHint') }, lockIcon(true));
  lock.addEventListener('click', () => {
    closed = !closed;
    lock.replaceChildren(lockIcon(!closed));
    lock.setAttribute('aria-pressed', String(closed));
  });
  const ok = h('button.tb-create__ok', { type: 'button', title: t('tournament.newTeam') }, '✓');
  const cancel = h('button.tb-create__cancel', { type: 'button', title: t('tournament.close') }, '×');
  const submit = () => { if (name.value.trim()) ctx.createTeam(name.value.trim(), closed, slot); };
  ok.addEventListener('click', submit);
  cancel.addEventListener('click', () => ctx.cancelCreating());
  name.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submit(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); ctx.cancelCreating(); }
  });
  // Without scrolling: the field takes the place of what was clicked, so nothing on the page needs to move for it.
  queueMicrotask(() => name.focus({ preventScroll: true }));
  return h('div.tb-row.tb-create', null, name, lock, ok, cancel);
}

function matchCard(ctx: BracketContext, card: Card, letter: string, half: Half): HTMLElement {
  const { view } = ctx;
  const m = card.match;
  const mine = view.you.team !== null && card.teams.includes(view.you.team);
  // Before the draw, a first-level match nobody is in yet is only a place the bracket may grow into.
  const ghost = !m && card.level === 0 && card.teams[0] === null && card.teams[1] === null;
  const classes = ['tb-match', m && `is-${m.state}`, mine && 'is-mine', m?.bye && 'is-bye', ghost && 'is-ghost'].filter(Boolean).join('.');
  const el = h(`article.${classes}`, { 'data-level': String(card.level), 'data-index': String(card.index), 'data-half': half },
    h('span.tb-match__letter', { 'aria-hidden': 'true' }, letter),
    h('div.tb-match__rows', null, teamRow(ctx, card, 0), teamRow(ctx, card, 1)),
  );
  const actions = h('div.tb-match__actions', null);
  if (m?.state === 'playing') actions.append(h('span.tb-flag.tb-flag--live', null, t('tournament.live')));
  if (mine && m && (m.state === 'ready' || m.state === 'playing') && !m.bye) {
    const go = h(`button.tb-pill${m.state === 'ready' ? '.tb-pill--ready' : '.tb-pill--watch'}`, { type: 'button' }, m.state === 'ready' ? t('tournament.readyToPlay') : t('tournament.watch'));
    go.addEventListener('click', () => ctx.enter());
    actions.append(go);
  } else if (m?.room) {
    const watch = h('button.tb-pill.tb-pill--watch', { type: 'button' }, m.watching ? `${t('tournament.watch')} · ${m.watching}` : t('tournament.watch'));
    watch.addEventListener('click', () => ctx.watch(card.level, card.index));
    actions.append(watch);
  } else if (m?.state === 'ready' && !m.bye) {
    actions.append(h('span.tb-flag', null, t('tournament.state.ready')));
  }
  if (view.you.organizer && m?.state === 'ready' && m.skippable) {
    const present = card.teams.map((team) => team !== null && view.teams[team]?.present);
    // The team that is there goes through; when neither came, lots decide (the side panel lets the organizer pick).
    if (present[0] !== present[1] || (!present[0] && !present[1])) {
      const skip = h('button.tb-pill.tb-pill--skip', { type: 'button' }, t('tournament.skip'));
      skip.addEventListener('click', () => ctx.skip(card.level, card.index));
      // On the card's lower edge: beside the state on the upper one, it would not fit a narrow card.
      el.append(h('div.tb-match__actions.tb-match__actions--below', null, skip));
    }
  }
  if (actions.childElementCount) el.append(actions);
  return el;
}

/** A level's head: its name and the game it plays, which opens the level's dialog: to change for the organizer, to look at for everybody else. */
function stageHead(ctx: BracketContext, level: number, depth: number): HTMLElement {
  const stage = depth - 1 - level;
  const game = stageSummary(ctx.view.settings.stages[stage]);
  const editable = ctx.view.you.organizer && stageOpen(ctx.view, level);
  const chip = h(`button.tb-head__game${editable ? '.is-editable' : ''}`, { type: 'button', 'aria-label': t('tournament.editStage', { stage: stageName(stage, depth) }) },
    game, ...(editable ? [h('span.tb-head__edit', { 'aria-hidden': 'true' }, '✎')] : []));
  chip.addEventListener('click', () => ctx.showStage(stage));
  return h('header.tb-head', null, h('h3.tb-head__stage', null, stageName(stage, depth)), chip);
}

/** The stage a level of the bracket is, for the side panel's list. */
export function stageEditable(view: TournamentView, stage: number): boolean {
  if (!view.you.organizer) return false;
  if (view.phase === 'registration') return true;
  const depth = view.bracket?.levels.length ?? 0;
  const level = depth - 1 - stage;
  return level >= 0 && stageOpen(view, level);
}

const CUP = '<path d="M14 8h20v8a10 10 0 0 1-20 0z" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="2"/><path d="M14 11H8v3a6 6 0 0 0 6 6M34 11h6v3a6 6 0 0 1-6 6M24 26v8M16 40h16M19 34h10v6H19z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>';

export function cupSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = CUP;
  return svg;
}

const CROWN = '<path d="M6 36l-2-22 12 10 8-14 8 14 12-10-2 22z" fill="currentColor" fill-opacity=".25" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 41h32" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>';

/** The crown the champion wears in the final. */
function crownSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'tb-row__crown');
  svg.innerHTML = CROWN;
  return svg;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The lines between the matches: from each match to the place its winner takes in the next, curved like the bracket in the menu's
 * charts. A line a winner has gone along glows; the others are faint. Drawn over the laid-out cards, and again when they move.
 */
function drawLines(root: HTMLElement, view: TournamentView): void {
  const svg = root.querySelector<SVGSVGElement>('.tb-lines');
  if (!svg) return;
  const box = root.getBoundingClientRect();
  svg.setAttribute('width', String(root.scrollWidth));
  svg.setAttribute('height', String(root.scrollHeight));
  svg.replaceChildren();
  // The bracket may be drawn smaller to fit the screen: the lines are drawn in its own, unscaled measure.
  const scale = box.width / root.offsetWidth || 1;
  const at = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { left: (r.left - box.left) / scale, right: (r.right - box.left) / scale, mid: (r.top - box.top + r.height / 2) / scale };
  };
  // The right half runs mirrored: a line leaves a card on its left and comes into the next one on its right.
  // A line ends on the next card's edge (not inside it, past its letter), at the height of the row the winner takes.
  const line = (from: Element, to: Element, toRow: Element, won: boolean, ghost: boolean, mirrored: boolean) => {
    const a = at(from);
    const b = { ...at(to), mid: at(toRow).mid };
    const x1 = mirrored ? a.left : a.right;
    const x2 = mirrored ? b.right : b.left;
    const bend = Math.max(12, Math.abs(x2 - x1) / 2) * (mirrored ? -1 : 1);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', `M${x1} ${a.mid} C${x1 + bend} ${a.mid} ${x2 - bend} ${b.mid} ${x2} ${b.mid}`);
    path.setAttribute('class', won ? 'is-won' : ghost ? 'is-ghost' : '');
    svg.append(path);
  };
  const levels = view.bracket?.levels;
  root.querySelectorAll<HTMLElement>('.tb-match[data-level]').forEach((card) => {
    const level = Number(card.dataset.level);
    const index = Number(card.dataset.index);
    const next = root.querySelector(`.tb-match[data-level="${level + 1}"][data-index="${index >> 1}"]`);
    const won = levels?.[level]?.[index]?.state === 'done';
    if (next) {
      // Into the final both halves come level from the sides, to the card's middle; elsewhere a line ends at the row the winner takes.
      const row = (next as HTMLElement).dataset.half === 'final' ? null : next.querySelectorAll('.tb-row')[index % 2];
      line(card, next, row ?? next, won, card.classList.contains('is-ghost'), card.dataset.half === 'right');
    }
  });
}

/**
 * The level whose game is pointed at (or tabbed to): lit on both sides, as the one game is set for both its halves. It is kept here,
 * not on the bracket, because the page draws the bracket anew on every change of a running tournament: the new one is lit at once
 * instead of fading in again, and moving between the parts of a head never switches it off and on.
 */
let linkedLevel: string | null = null;
let linking = false;

function lightLevel(el: ParentNode): void {
  el.querySelectorAll('.tb-level').forEach((column) => column.classList.toggle('is-linked', (column as HTMLElement).dataset.level === linkedLevel));
}

/** One listener for the whole page: whatever is pointed at or focused says which level is lit, or that none is. */
function linkHalves(el: HTMLElement): void {
  lightLevel(el);
  if (linking) return;
  linking = true;
  const follow = (event: Event) => {
    const head = (event.target as Element | null)?.closest?.('.tb .tb-head__game');
    const level = head?.closest<HTMLElement>('.tb-level')?.dataset.level ?? null;
    if (level === linkedLevel) return;
    linkedLevel = level;
    lightLevel(document);
  };
  document.addEventListener('pointerover', follow);
  document.addEventListener('focusin', follow);
  document.documentElement.addEventListener('pointerleave', () => { linkedLevel = null; lightLevel(document); });
}

/**
 * Under a full bracket: the way to found one team more, which makes the bracket grow. It is no place in the bracket, as no match
 * waits for that team yet; the bracket doubles once it is there.
 */
function growButton(ctx: BracketContext): HTMLElement[] {
  const size = growsTo(ctx.view);
  const slot = nextPlace(ctx.view);
  if (size === null || slot === null) return [];
  if (ctx.creatingAt === 'grow') return [h('div.tb-grow', null, h('article.tb-match.tb-grow__form', null, h('div.tb-match__rows', null, createRow(ctx, slot))))];
  const add = h('button.tb-grow__button', { type: 'button' },
    h('span.tb-row__plus', { 'aria-hidden': 'true' }, '+'),
    h('span.tb-grow__text', null,
      h('span.tb-grow__title', null, t('tournament.foundTeam')),
      h('span.tb-grow__hint', null, t('tournament.growsTo', { n: size }))));
  add.addEventListener('click', () => ctx.startCreating('grow'));
  return [h('div.tb-grow', null, add)];
}

/** Which part of the split bracket a match sits in: the top half of each level runs in from the left, the bottom half from the right. */
type Half = 'left' | 'right' | 'final';

/** A match's letter: A to Z, then AA, AB, … for a bracket with more matches than letters. */
function matchLetter(n: number): string {
  return n < 26 ? String.fromCharCode(65 + n) : matchLetter(Math.floor(n / 26) - 1) + String.fromCharCode(65 + (n % 26));
}

/**
 * The bracket, split as a cup's poster is: the top half of every level runs in from the left, the bottom half from the right, and
 * the final stands in the middle between them. A level's game is set once for both its halves: pointing at one half's head lights
 * the other's too. The lines between are drawn over it.
 */
export function bracketView(ctx: BracketContext): HTMLElement {
  const { view } = ctx;
  const levels = view.bracket ? drawnCards(view) : previewCards(view);
  const depth = levels.length;
  const final = depth - 1;
  // Letters go level by level, top to bottom, as they did before the split: A is the first match of the first level.
  const letters = new Map<Card, string>();
  let letter = 0;
  for (const cards of levels) for (const card of cards) letters.set(card, matchLetter(letter++));
  const column = (level: number, half: Half) => {
    const cards = levels[level];
    const shown = half === 'left' ? cards.slice(0, cards.length / 2) : half === 'right' ? cards.slice(cards.length / 2) : cards;
    return h(`section.tb-level.tb-level--${half}`, { 'data-level': String(level) },
      stageHead(ctx, level, depth),
      h('div.tb-col', null,
        ...shown.map((card) => h('div.tb-cell', null, matchCard(ctx, card, letters.get(card)!, half))),
      ),
    );
  };
  const below = Array.from({ length: final }, (_, level) => level);
  const columns = [
    ...below.map((level) => column(level, 'left')),
    column(final, 'final'),
    ...below.reverse().map((level) => column(level, 'right')),
  ];
  const lines = document.createElementNS(SVG_NS, 'svg');
  lines.setAttribute('class', 'tb-lines');
  lines.setAttribute('aria-hidden', 'true');
  const el = h('div.tb', { style: `--columns: ${columns.length}` }, lines, ...columns, ...growButton(ctx));
  linkHalves(el);
  const fit = h('div.tb-fit', null, el);
  // Laid out at once as the bracket before it was: until it is measured on the page, an empty place would let the page jump and
  // take the pointer off the head it rests on.
  if (lastFit) applyFit(fit, el, lastFit);
  // The bracket is drawn anew on every change: an old one's observer lets go once it is off the page.
  let shown = false;
  let watching = false;
  const observer = new ResizeObserver(() => redraw());
  const redraw = () => {
    if (fit.isConnected) {
      shown = true;
      if (!watching && fit.parentElement) {
        // The space it fits into: the box it sits in (its width) and the page's scroll box (its height).
        watching = true;
        observer.observe(fit.parentElement);
        observer.observe(fit.closest('.menu-page__body') ?? document.documentElement);
      }
      fitToBox(fit, el);
      drawLines(el, view);
    } else if (shown) observer.disconnect();
  };
  requestAnimationFrame(redraw);
  observer.observe(el);
  return fit;
}

/** Below this the bracket is not shrunk further: it scrolls instead, as text smaller than that is hard to read. */
const MIN_SCALE = 0.62;

/**
 * Fits the bracket on the screen without scrolling: its columns narrow to the width there is first, and when it is still too wide
 * or too tall for what is left of the page below it, the whole bracket is drawn smaller. A phone keeps it at full size and scrolls.
 */
function fitToBox(fit: HTMLElement, el: HTMLElement): void {
  const lines = el.querySelector('.tb-lines');
  // The old lines would hold the bracket at the size it had: they are drawn again after.
  lines?.setAttribute('width', '0');
  lines?.setAttribute('height', '0');
  const width = fit.clientWidth;
  el.style.width = `${width}px`;
  const naturalWidth = Math.max(width, el.scrollWidth);
  el.style.width = `${naturalWidth}px`;
  const naturalHeight = el.offsetHeight;
  let scale = 1;
  if (!matchMedia('(max-width: 760px)').matches) {
    const scroller = fit.closest<HTMLElement>('.menu-page__body');
    const top = fit.getBoundingClientRect().top + (scroller ? scroller.scrollTop : window.scrollY);
    const bottom = scroller
      ? scroller.getBoundingClientRect().bottom - parseFloat(getComputedStyle(scroller).paddingBottom)
      : window.innerHeight;
    // What follows the bracket in its box (its padding) still has to fit.
    const after = fit.parentElement ? parseFloat(getComputedStyle(fit.parentElement).paddingBottom) : 0;
    const room = bottom - top - after;
    scale = Math.min(1, width / naturalWidth, room > 0 ? room / naturalHeight : 1);
    scale = Math.max(MIN_SCALE, scale);
  }
  lastFit = {
    width: `${naturalWidth}px`,
    transform: scale < 1 ? `scale(${scale})` : '',
    left: `${Math.max(0, (width - naturalWidth * scale) / 2)}px`,
    height: `${Math.ceil(naturalHeight * scale)}px`,
    outerWidth: naturalWidth * scale > width + 0.5 ? `${Math.ceil(naturalWidth * scale)}px` : '',
  };
  applyFit(fit, el, lastFit);
}

/** How the bracket was last fitted, to lay a new one out the same way before it is measured. */
interface Fit { width: string; transform: string; left: string; height: string; outerWidth: string }
let lastFit: Fit | null = null;

function applyFit(fit: HTMLElement, el: HTMLElement, at: Fit): void {
  el.style.width = at.width;
  el.style.transform = at.transform;
  el.style.left = at.left;
  fit.style.height = at.height;
  fit.style.width = at.outerWidth;
}

/** Where your team stands: the match it plays now or next. */
export function ownMatch(view: TournamentView): { level: number; index: number; match: TournamentMatch } | null {
  const team = view.you.team;
  if (team === null || !view.bracket) return null;
  for (const [level, matches] of view.bracket.levels.entries()) {
    for (const [index, match] of matches.entries()) {
      if (match.state !== 'done' && match.teams.includes(team)) return { level, index, match };
    }
  }
  return null;
}
