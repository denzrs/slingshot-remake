import '@fontsource/big-shoulders-stencil-display/800';
import '@fontsource/b612/400';
import '@fontsource/b612/700';
import '@fontsource/b612-mono/400';
import '../../styles/base.css';
import './tournament.css';
import './bracket-gallery.css';
import { isLang, setLang } from '../../platform/i18n';
import { AVATARS } from '../../platform/avatars';
import { EMBLEMS } from '../../platform/emblems';
import { ROOM_COLORS } from '../../data/roomLook';
import type { TournamentMatch, TournamentView } from '../../net/net';
import { h } from '../menu/menu';
import { bracketView, type BracketContext } from './bracket';
import { defaultStages, levelsFor, stageName } from './setup';

/**
 * Dev-only page (`/dev/tournament.html`, never part of a build): a whole tournament simulated in the page, without a relay. Pick how
 * many teams, look at the bracket while they register, draw it, and play it out match by match, level by level or to the end, as
 * the relay would tell it. Clicking a level's game changes its rounds, for both halves at once. The notes are German, as the other
 * galleries' are.
 */

const NAMES = [
  'Kometen', 'Nebelwölfe', 'Polarstern', 'Schwerkraft', 'Supernova', 'Orbit 9', 'Ereignishorizont', 'Roter Zwerg',
  'Andromeda', 'Quasar', 'Sternenstaub', 'Perihel', 'Pulsar', 'Lagrange-Punkt', 'Gezeitenkraft', 'Sonnenwind',
];
const ROUNDS = [1, 3, 5, 7];

const requestedLanguage = new URLSearchParams(location.search).get('lang');
setLang(isLang(requestedLanguage) ? requestedLanguage : 'de');

const sim = {
  teams: 16,
  teamSize: 1,
  /** Your team, or null to look on as an organizer without one. */
  mine: 2 as number | null,
  organizer: true,
  view: null as unknown as TournamentView,
  selected: null as number | null,
  creatingAt: null as string | null,
  seen: new Set<number>(),
  auto: 0 as ReturnType<typeof setInterval> | 0,
  speed: 500,
  note: '',
};

const random = (n: number) => Math.floor(Math.random() * n);

function newTeam(view: TournamentView, slot: number, name: string): void {
  const i = view.teams.length;
  const members = Array.from({ length: sim.teamSize }, (_, k) => {
    view.people.push({ name: `${name} ${k + 1}`, avatar: AVATARS[(i * 3 + k) % AVATARS.length], connected: true, team: i, organizer: false, gone: false });
    return view.people.length - 1;
  });
  view.teams.push({ name, slot, closed: i % 5 === 3, code: null, members, withdrawn: false, present: true, emblem: EMBLEMS[i % EMBLEMS.length], color: ROOM_COLORS[(i * 5) % ROOM_COLORS.length] });
}

/** A tournament in registration with `sim.teams` teams, in the order they came. */
function registration(): TournamentView {
  const view: TournamentView = {
    code: 'B93-K98', phase: 'registration', expiresIn: 3 * 3600 + 20 * 60,
    settings: { teamSize: sim.teamSize, maxTeams: 16, stages: defaultStages() },
    people: [], teams: [], bracket: null,
    you: { id: 0, token: '', organizer: sim.organizer, team: null },
  };
  for (let i = 0; i < sim.teams; i++) newTeam(view, i, NAMES[i % NAMES.length]);
  setYou(view);
  return view;
}

function setYou(view: TournamentView): void {
  const mine = sim.mine !== null && sim.mine < view.teams.length ? sim.mine : null;
  if (mine === null) {
    let id = view.people.findIndex((p) => p.team === null);
    if (id < 0) id = view.people.push({ name: 'Du', avatar: AVATARS[0], connected: true, team: null, organizer: true, gone: false }) - 1;
    view.you = { id, token: '', organizer: sim.organizer, team: null };
  } else {
    view.you = { id: view.teams[mine].members[0], token: '', organizer: sim.organizer, team: mine };
  }
}

const emptyMatch = (): TournamentMatch => ({
  teams: [null, null], state: 'waiting', winner: null, bye: false, score: null, room: false, watching: 0, live: null,
  simulated: false, waited: null, skippable: false,
});

/** Draws the bracket as the relay does at the start: teams shuffled, byes spread over the halves. */
function draw(view: TournamentView): void {
  const depth = levelsFor(view.teams.length);
  const size = 2 ** depth;
  const first = size / 2;
  const order = [...view.teams.keys()].sort(() => Math.random() - 0.5);
  // As the relay spreads them (server/src/tournament/bracket.rs): match `k * first / byes` for each bye k.
  const count = size - order.length;
  const byes = new Set(Array.from({ length: count }, (_, k) => Math.floor((k * first) / count)));
  const levels = Array.from({ length: depth }, (_, level) => Array.from({ length: size >> (level + 1) }, emptyMatch));
  let next = 0;
  levels[0].forEach((match, i) => {
    match.teams = [order[next++], byes.has(i) ? null : order[next++]];
    if (byes.has(i)) Object.assign(match, { bye: true, state: 'done', winner: match.teams[0] });
  });
  view.phase = 'running';
  view.bracket = { levels, champion: null };
  advance(view);
}

const roundsOf = (view: TournamentView, level: number) => Math.max(1, view.settings.stages[view.bracket!.levels.length - 1 - level].rules.rounds || 3);

/** Winners move on; a match whose two teams are known gets ready; the final's winner is champion. */
function advance(view: TournamentView): void {
  const levels = view.bracket!.levels;
  levels.forEach((matches, level) => matches.forEach((match, index) => {
    if (match.state === 'done' && level + 1 < levels.length) levels[level + 1][index >> 1].teams[index % 2] = match.winner;
    if (match.state === 'waiting' && match.teams[0] !== null && match.teams[1] !== null) Object.assign(match, { state: 'ready', waited: 0 });
  }));
  const final = levels[levels.length - 1][0];
  if (final.state === 'done') {
    view.bracket!.champion = final.winner;
    view.phase = 'finished';
    stopAuto();
  }
}

/** One step of one match: it opens, plays a round, or ends. */
function stepMatch(view: TournamentView, level: number, index: number): void {
  const match = view.bracket!.levels[level][index];
  if (match.state === 'ready') {
    Object.assign(match, { state: 'playing', room: true, waited: null, skippable: false, watching: random(4), live: { round: 1, score: [0, 0] } });
    return;
  }
  if (match.state !== 'playing' || !match.live) return;
  const score = match.live.score ?? [0, 0];
  const played: [number, number] = [score[0] + 300 + random(1100), score[1] + 300 + random(1100)];
  if (match.live.round >= roundsOf(view, level)) {
    if (played[0] === played[1]) played[random(2)] += 50;
    Object.assign(match, { state: 'done', room: false, live: null, watching: 0, score: played, winner: match.teams[played[0] > played[1] ? 0 : 1] });
  } else {
    match.live = { round: match.live.round + 1, score: played };
  }
}

/** The matches that can move on now, as `[level, index]`. */
function movable(view: TournamentView): [number, number][] {
  return view.bracket!.levels.flatMap((matches, level) => matches.flatMap((m, index): [number, number][] => m.state === 'ready' || m.state === 'playing' ? [[level, index]] : []));
}

/** One step of the whole tournament: a match picked at random moves on, the others that wait count on. */
function step(): boolean {
  const view = sim.view;
  if (view.phase === 'registration' && view.teams.length >= 2) draw(view);
  if (view.phase !== 'running') return false;
  const open = movable(view);
  if (!open.length) return false;
  const [level, index] = open[random(open.length)];
  stepMatch(view, level, index);
  for (const [l, i] of open) {
    const m = view.bracket!.levels[l][i];
    if (m.state === 'ready' && m.waited !== null) Object.assign(m, { waited: m.waited + 30, skippable: m.waited + 30 >= 90 });
  }
  advance(view);
  return true;
}

/** Plays out every match of the lowest level not yet finished. */
function finishLevel(): void {
  const view = sim.view;
  if (view.phase === 'registration' && view.teams.length >= 2) draw(view);
  if (view.phase !== 'running') return;
  const level = view.bracket!.levels.findIndex((matches) => matches.some((m) => m.state !== 'done'));
  if (level < 0) return;
  for (let guard = 0; guard < 500 && view.bracket!.levels[level].some((m) => m.state !== 'done'); guard++) {
    view.bracket!.levels[level].forEach((m, index) => { if (m.state !== 'done') stepMatch(view, level, index); });
  }
  advance(view);
}

function stopAuto(): void {
  if (sim.auto) clearInterval(sim.auto);
  sim.auto = 0;
}

function reset(): void {
  stopAuto();
  sim.view = registration();
  sim.selected = null;
  sim.creatingAt = null;
  sim.seen.clear();
}

const ctx = (): BracketContext => ({
  view: sim.view, selectedTeam: sim.selected, creatingAt: sim.creatingAt, seenTeams: sim.seen,
  selectTeam: (team) => { sim.selected = sim.selected === team ? null : team; sim.note = `Du hast „${sim.view.teams[team].name}“ gewählt.`; render(); },
  startCreating: (slot) => { sim.creatingAt = slot; render(); },
  cancelCreating: () => { sim.creatingAt = null; render(); },
  createTeam: (name, closed, slot) => {
    sim.creatingAt = null;
    newTeam(sim.view, slot, name);
    sim.view.teams[sim.view.teams.length - 1].closed = closed;
    sim.teams = sim.view.teams.length;
    render();
  },
  showStage: (stage) => {
    // Stands in for the level's dialog: its rounds go round 1, 3, 5, 7, and both halves of the level show the change.
    const rules = sim.view.settings.stages[stage].rules;
    rules.rounds = ROUNDS[(ROUNDS.indexOf(rules.rounds) + 1) % ROUNDS.length];
    const depth = sim.view.bracket?.levels.length ?? levelsFor(sim.view.teams.length);
    sim.note = `${stageName(stage, depth)} spielt jetzt ${rules.rounds === 1 ? '1 Runde' : `${rules.rounds} Runden`}${stage === 0 ? '' : ', links wie rechts'}.`;
    render();
  },
  enter: () => {
    const own = movable(sim.view).find(([l, i]) => sim.view.bracket!.levels[l][i].teams.includes(sim.view.you.team));
    if (own) { stepMatch(sim.view, own[0], own[1]); advance(sim.view); }
    render();
  },
  watch: (level, index) => { sim.view.bracket!.levels[level][index].watching++; render(); },
  skip: (level, index, team) => {
    const m = sim.view.bracket!.levels[level][index];
    Object.assign(m, { state: 'done', room: false, live: null, skippable: false, waited: null, winner: team ?? m.teams[random(2)] });
    advance(sim.view);
    render();
  },
});

// ————————————————————————————— The page —————————————————————————————

const field = (label: string, control: HTMLElement) => h('label.tg-field', null, h('span', null, label), control);

function select(options: [string, string][], value: string, change: (value: string) => void): HTMLSelectElement {
  const el = h('select', null) as HTMLSelectElement;
  for (const [v, label] of options) el.append(new Option(label, v, v === value, v === value));
  el.addEventListener('change', () => change(el.value));
  return el;
}

function action(label: string, run: () => void, primary = false): HTMLButtonElement {
  const el = h(`button.tg-button${primary ? '.tg-button--primary' : ''}`, { type: 'button' }, label) as HTMLButtonElement;
  el.addEventListener('click', run);
  return el;
}

const controls = h('div.tg-controls', null);
const stage = h('div.tg-stage.menu-page--tournament', null);
const status = h('p.tg-status', { role: 'status' });
document.body.append(h('main.tg', null,
  h('header.tg-head', null,
    h('p.tg-eyebrow', null, 'Dev · Turnier'),
    h('h1', null, 'Turnierbaum-Simulation'),
    h('p.tg-intro', null, 'Du spielst hier ein Turnier ohne Relay durch, von der Anmeldung bis zum Champion. '
      + 'Klickst du auf das Spiel einer Runde, änderst du ihre Rundenzahl für beide Hälften. Zeigst du darauf, leuchten beide Hälften auf.'),
  ),
  controls, status, h('div.t-bracket.tg-bracket', null, stage)));

function paintControls(): void {
  const view = sim.view;
  const running = view.phase === 'running';
  const play = action(sim.auto ? '❚❚ Pause' : '▶ Abspielen', () => {
    if (sim.auto) stopAuto();
    else sim.auto = setInterval(() => { if (!step()) stopAuto(); render(); }, sim.speed);
    render();
  });
  controls.replaceChildren(
    field('Teams', select(Array.from({ length: 17 }, (_, i) => [String(i), String(i)]), String(sim.teams), (v) => { sim.teams = Number(v); reset(); render(); })),
    field('Spieler je Team', select([1, 2, 3, 4].map((n) => [String(n), `${n} gegen ${n}`]), String(sim.teamSize), (v) => { sim.teamSize = Number(v); reset(); render(); })),
    field('Deine Sicht', select([['none', 'Kein Team'], ...view.teams.map((team, i): [string, string] => [String(i), team.name])], sim.mine === null ? 'none' : String(sim.mine), (v) => {
      sim.mine = v === 'none' ? null : Number(v);
      setYou(sim.view);
      render();
    })),
    field('Rolle', select([['org', 'Organisator'], ['player', 'Spieler']], sim.organizer ? 'org' : 'player', (v) => { sim.organizer = v === 'org'; setYou(sim.view); render(); })),
    field('Tempo', select([['900', 'Langsam'], ['500', 'Normal'], ['150', 'Schnell']], String(sim.speed), (v) => {
      sim.speed = Number(v);
      if (sim.auto) { stopAuto(); sim.auto = setInterval(() => { if (!step()) stopAuto(); render(); }, sim.speed); }
    })),
    h('div.tg-actions', null,
      action('Neu anmelden', () => { reset(); render(); }),
      action(view.phase === 'registration' ? 'Auslosen' : 'Neu auslosen', () => {
        stopAuto();
        if (sim.view.teams.length < 2) return;
        // The same teams drawn again: only the bracket is thrown away.
        Object.assign(sim.view, { phase: 'registration', bracket: null });
        draw(sim.view);
        render();
      }, view.phase === 'registration'),
      action('Schritt', () => { step(); render(); }),
      action('Runde fertig', () => { finishLevel(); render(); }),
      action('Bis zum Ende', () => { stopAuto(); for (let i = 0; i < 2000 && step();) i++; render(); }),
      play,
    ),
  );
  if (!running && view.phase !== 'registration') play.disabled = true;
}

function phaseNote(view: TournamentView): string {
  if (view.phase === 'registration') return `Anmeldung: ${view.teams.length} von ${view.settings.maxTeams} Teams.`;
  const levels = view.bracket!.levels;
  if (view.phase === 'finished') return `${view.teams[view.bracket!.champion!].name} ist Champion.`;
  const live = levels.flat().filter((m) => m.state === 'playing').length;
  const done = levels.flat().filter((m) => m.state === 'done' && !m.bye).length;
  const total = levels.flat().filter((m) => !m.bye).length;
  return `Läuft: ${done} von ${total} Matches fertig, ${live} live.`;
}

function render(): void {
  const scroll = document.querySelector('.tg-bracket')?.scrollLeft ?? 0;
  paintControls();
  status.textContent = [phaseNote(sim.view), sim.note].filter(Boolean).join(' · ');
  sim.note = '';
  stage.replaceChildren(bracketView(ctx()));
  for (const team of sim.view.teams.keys()) sim.seen.add(team);
  const bracket = document.querySelector('.tg-bracket');
  if (bracket) bracket.scrollLeft = scroll;
}

reset();
// `?phase=running` opens it drawn, `?phase=live` partway played, `?phase=finished` played out; `?teams=n` sets how many.
const params = new URLSearchParams(location.search);
const teams = Number(params.get('teams'));
if (params.has('teams') && teams >= 0 && teams <= 16) { sim.teams = teams; reset(); }
const phase = params.get('phase');
if (sim.view.teams.length >= 2 && (phase === 'running' || phase === 'live' || phase === 'finished')) draw(sim.view);
if (phase === 'live') { finishLevel(); for (let i = 0; i < 6; i++) step(); }
if (phase === 'finished') while (step());
render();
