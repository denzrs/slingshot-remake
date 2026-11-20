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

/** One match as the bracket draws it. While teams register, `free` marks the places still open. */
interface Card {
  level: number;
  index: number;
  teams: [number | null, number | null];
  free: [boolean, boolean];
  match: TournamentMatch | null;
  /** For the card that takes a team beyond a full bracket: the place it founds one in. */
  addSlot?: number;
}

/**
 * The bracket while teams register: as big as the teams there need, with a place more until it is full, so it grows as teams
 * come. Who meets whom is drawn only at the start; until then the teams sit in the order they came, and a place left empty at the
 * start is a bye.
 */
function previewSize(view: TournamentView): number {
  // Just what the teams so far need: a bracket they can play as it stands. One more team makes it grow.
  const top = view.teams.reduce((most, team) => Math.max(most, team.slot + 1), 0);
  return 2 ** Math.ceil(Math.log2(Math.max(2, top)));
}

/** How many levels the bracket on screen has: the drawn one's, or what the teams so far (and room for one more) would need. */
export function bracketDepth(view: TournamentView): number {
  return view.bracket ? view.bracket.levels.length : Math.log2(previewSize(view));
}

function previewCards(view: TournamentView): Card[][] {
  const size = previewSize(view);
  const levels: Card[][] = [];
  for (let level = 0, matches = size / 2; matches >= 1; level++, matches /= 2) {
    levels.push(Array.from({ length: matches }, (_, index): Card => ({ level, index, teams: [null, null], free: [false, false], match: null })));
  }
  // In the order they came, two to a match.
  const at = (slot: number): number | null => { const found = view.teams.findIndex((team) => team.slot === slot); return found < 0 ? null : found; };
  levels[0].forEach((card, i) => {
    card.teams = [at(2 * i), at(2 * i + 1)];
    card.free = [card.teams[0] === null, card.teams[1] === null];
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
      const slot = card.addSlot ?? card.index * 2 + side;
      if (ctx.creatingAt === key) return createRow(ctx, slot);
      const add = h('button.tb-row.tb-row--free', { type: 'button', 'data-side': String(side) },
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
  queueMicrotask(() => name.focus());
  return h('div.tb-row.tb-create', null, name, lock, ok, cancel);
}

function matchCard(ctx: BracketContext, card: Card, letter: string): HTMLElement {
  const { view } = ctx;
  const m = card.match;
  const mine = view.you.team !== null && card.teams.includes(view.you.team);
  // Before the draw, a first-level match nobody is in yet is only a place the bracket may grow into.
  const ghost = !m && card.level === 0 && card.teams[0] === null && card.teams[1] === null;
  const classes = ['tb-match', m && `is-${m.state}`, mine && 'is-mine', m?.bye && 'is-bye', ghost && 'is-ghost'].filter(Boolean).join('.');
  const el = h(`article.${classes}`, { 'data-level': String(card.level), 'data-index': String(card.index) },
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
  const at = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { left: r.left - box.left + root.scrollLeft, right: r.right - box.left + root.scrollLeft, mid: r.top - box.top + root.scrollTop + r.height / 2 };
  };
  const line = (from: Element, to: Element, won: boolean, ghost = false) => {
    const a = at(from);
    const b = at(to);
    const x1 = a.right;
    const x2 = b.left;
    const bend = Math.max(12, (x2 - x1) / 2);
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
      const row = next.querySelectorAll('.tb-row')[index % 2];
      line(card, row ?? next, won, card.classList.contains('is-ghost'));
    }
  });
}

/** The bracket: a column per level from the first played to the final, the winner's box after it, the lines between. */
export function bracketView(ctx: BracketContext): HTMLElement {
  const { view } = ctx;
  const levels = view.bracket ? drawnCards(view) : previewCards(view);
  const depth = levels.length;
  let letter = 0;
  // A full bracket has no free place to found a team in: one more card at the foot of the first level takes the next, and the bracket grows.
  const growing = !view.bracket && view.phase === 'registration' && view.teams.length < view.settings.maxTeams && view.teams.length === levels[0].length * 2;
  const columns = levels.map((cards, level) => h(`section.tb-level${level === depth - 1 ? '.tb-level--final' : ''}`, null,
    stageHead(ctx, level, depth),
    h('div.tb-col', null,
      ...cards.map((card) => h('div.tb-cell', null, matchCard(ctx, card, String.fromCharCode(65 + letter++)))),
      ...(growing && level === 0 ? [h('div.tb-cell.tb-cell--add', null, h('article.tb-match.is-ghost.tb-match--add', null, h('div.tb-match__rows', null,
        teamRow(ctx, { level: 0, index: -1, teams: [null, null], free: [true, false], match: null, addSlot: levels[0].length * 2 }, 0))))] : []),
    ),
  ));
  const lines = document.createElementNS(SVG_NS, 'svg');
  lines.setAttribute('class', 'tb-lines');
  lines.setAttribute('aria-hidden', 'true');
  const el = h(`div.tb${growing ? '.tb--growing' : ''}`, { style: `--levels: ${depth}` }, lines, ...columns);
  // The bracket is drawn anew on every change: an old one's observer lets go once it is off the page.
  let shown = false;
  const observer = new ResizeObserver(() => redraw());
  const redraw = () => {
    if (el.isConnected) {
      shown = true;
      drawLines(el, view);
    } else if (shown) observer.disconnect();
  };
  requestAnimationFrame(redraw);
  observer.observe(el);
  return el;
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
