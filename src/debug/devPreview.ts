import { createMatch, type Match } from '../game';
import type { ClassicMatch } from '../game/classic';
import { planShot } from '../sim/ai';
import { createRng, randomSeed } from '../sim/rng';
import { DEFAULT_SETTINGS } from '../data/settings';
import type { Anomaly } from '../sim/config';

/** Dev-only screens opened with ?preview=bets-card|bets-pause|bets-live|fans-live|stands-card|stands-pause|card-marks|mayhem-anomalies|mayhem-extreme. */
export type UiPreview = 'bets-card' | 'bets-pause' | 'bets-live' | 'fans-live' | 'stands-card' | 'stands-pause' | 'card-marks' | 'mayhem-anomalies' | 'mayhem-extreme';

export const UI_PREVIEWS: readonly UiPreview[] = ['bets-card', 'bets-pause', 'bets-live', 'fans-live', 'stands-card', 'stands-pause', 'card-marks', 'mayhem-anomalies', 'mayhem-extreme'];

const BET_SCORES = [
  { player: 0, bets: 2, won: 1, net: 420 },
  { player: 1, bets: 2, won: 2, net: 610 },
  { player: 2, bets: 1, won: 0, net: -210 },
];

/** A reproducible six-ship online match with two shot-down humans: one has bet on the round, the other is about to. */
export function createUiPreview(mode: UiPreview): Match {
  if (mode === 'bets-live') return betsLive(true);
  if (mode === 'fans-live') return betsLive(false);
  const seats = ['human', 'human', 'medium', 'medium', 'medium', 'medium'] as const;
  const names = ['Du', 'Mira', 'Rook', 'Nia', 'Oskar', 'Vega'];
  const anomalies: Anomaly[] = mode === 'mayhem-anomalies'
    ? ['pinball']
    : mode === 'mayhem-extreme'
    ? ['trickShots', 'pinball', 'fuse', 'fusion', 'whiteHole', 'unstable']
    : [];
  const settings = {
    ...DEFAULT_SETTINGS,
    seats: [...seats],
    rounds: 3,
    betting: true,
    menuBackground: false,
    menuSounds: false,
    gameSounds: false,
    anomalies,
  };
  const match = createMatch('classic', settings, {
    seats: [...seats],
    names,
    online: true,
    seed: 24681357,
  });

  match.round = 2;
  match.totalRounds = 3;
  match.clock = 81;
  match.phase = 'aiming';
  match.phaseTime = 8;
  match.current = 2;
  match.viewer = mode.startsWith('stands-') ? null : 0;
  match.spectatorId = mode.startsWith('stands-') ? 0 : null;

  const alive = [2, 3, 4, 5];
  // You are out with 1800 points and have picked Rook to bet on: the card offers the stakes.
  const matchScores = [1800, 2500, 3250, 2930, 2220, 1720];
  match.players.forEach((player, id) => {
    player.alive = alive.includes(id);
    player.score = matchScores[id];
  });

  if (mode === 'card-marks') return cardMarks(match);

  if (mode === 'mayhem-anomalies') {
    match.round = 1;
    match.totalRounds = 5;
    match.mayhem = { twists: [{ id: 'billiard', n: 2 }], finale: false, jackpot: false };
    match.anomalyAlert = true;
    match.revealHeld = true;
    match.revealEnd = match.clock + 999;
    return match;
  }

  if (mode === 'mayhem-extreme') {
    match.round = 1;
    match.totalRounds = 5;
    match.mayhem = {
      twists: [
        { id: 'billiard', n: 2 },
        { id: 'plasmaStorm' },
        { id: 'minefield' },
        { id: 'precision', n: 85 },
      ],
      finale: true,
      jackpot: true,
    };
    match.anomalyAlert = true;
    match.revealHeld = true;
    match.revealEnd = match.clock + 999;
    return match;
  }

  match.bets.openRound(alive, false);
  match.bets.place(1, 2, 250, alive, alive.length);
  match.bets.pending = { id: match.bets.question!.id, pick: 2 };
  for (const { player, ...score } of BET_SCORES) Object.assign(match.bets.scores[player], score);

  if (mode.startsWith('stands-')) {
    match.crowd.seats = [{ id: 0, name: 'Tess', balance: 500, present: true }];
    match.stands.openRound(alive, false);
    match.stands.place(0, 2, 250, alive, alive.length);
    Object.assign(match.stands.scores[0], { bets: 1, won: 1, net: 180 });
  }

  return match;
}

/**
 * Everything a card can say, at once: you (ship 0) are alone in last place and aim first, Mira leads, Nia shot you down last round,
 * you shot Oskar down twice running and Vega is on a spree. The history is the match's own private state, set the way a played round would.
 */
function cardMarks(match: Match): Match {
  match.current = 0;
  match.players.forEach((player, id) => {
    player.alive = true;
    player.shots = 0;
    player.score = [900, 3400, 2100, 1800, 1500, 2300][id];
  });
  const grudges = match as unknown as { killedBefore: Map<number, number>[]; killChain: Map<number, number>; roundScores: number[] };
  grudges.killedBefore = [new Map([[0, 3], [4, 0]]), new Map([[4, 0]])];
  grudges.killChain = new Map([[5, 2]]);
  grudges.roundScores = match.players.map((player) => player.score);
  return match;
}

/** How long a pretend player of `bets-live` takes over a shot: long enough to bet between the shots. */
const LIVE_AIM_SECONDS = [3.5, 5.5] as const;

/**
 * `?preview=bets-live`: the bets played for real, offline. You (ship 0) are out from the start of every round with
 * 1800 points; four pretend players aim at each other by themselves, a few seconds apart. You bet on the round, and
 * Space goes on to the next. `?preview=fans-live` is the same in a room without bets: you root for a ship, cheer
 * it on (G) and call its next shot (T, D, X). The pretend players shot down root, call and cheer too.
 */
function betsLive(betting: boolean): Match {
  const seats = ['human', 'human', 'human', 'human', 'human', 'off'] as const;
  const names = ['Du', 'Mira', 'Rook', 'Nia', 'Oskar'];
  const settings = { ...DEFAULT_SETTINGS, seats: [...seats], rounds: 5, maxPlanets: 3, betting, menuBackground: false, menuSounds: false };
  const match = createMatch('classic', settings, { seats: [...seats], names, online: true, seed: Math.floor(Math.random() * 1e9) }) as ClassicMatch;
  match.viewer = 0;
  match.players[0].score = 1800;
  const inner = match as unknown as { nextTurn(): void; openBets(): void };

  /** You are out before the first shot: your ship leaves the field, and the round's bet opens. */
  const benchYou = () => {
    const you = match.players[0];
    you.alive = false;
    if (match.world.ships[0]) match.world.ships[0].alive = false;
    if (match.current === 0) inner.nextTurn();
    inner.openBets();
  };

  /** A pretend player's shot, aimed the way a medium CPU would aim it: it hits now and then. */
  const rng = createRng(randomSeed());
  const shoot = (id: number) => {
    if (match.current !== id || match.phase !== 'aiming' || !match.players[id].alive) return;
    const planner = planShot(match.world, id, { rules: match.rules, level: 'medium', attempt: match.players[id].shots, fixedPower: null, rng, effort: 0.6 });
    let step = planner.next();
    while (!step.done) step = planner.next();
    match.setPlayerAim(id, step.value.angle, step.value.power);
    match.commitPlayer(id);
  };

  match.on((e) => {
    if (e.type === 'round') benchYou();
    if (e.type === 'turn' && e.player !== 0) {
      const [least, most] = LIVE_AIM_SECONDS;
      setTimeout(() => shoot(e.player), (least + Math.random() * (most - least)) * 1000);
    }
  });
  // The pretend players shot down root for somebody too, and cheer now and then.
  setInterval(() => {
    for (const p of match.players) {
      if (p.id === 0 || p.alive) continue;
      const choices = match.fanChoices;
      if (!match.fans.of(p.id) && choices.length) match.follow(p.id, choices[Math.floor(Math.random() * choices.length)]);
      else if (match.canCall(p.id) && match.fans.of(p.id)?.call?.state !== 'open' && Math.random() < 0.6) match.callShot(p.id, (['hit', 'miss', 'hitBy'] as const)[Math.floor(Math.random() * 3)]);
      else if (Math.random() < 0.3) match.cheerOn(p.id);
    }
    // And the stands: nine watching, each rooting for somebody in a UFO of their own, cheering now and then.
    for (const seat of match.crowd.seats) {
      const choices = match.fanChoices;
      if (!match.standsFans.of(seat.id) && choices.length) match.follow(seat.id, choices[Math.floor(Math.random() * choices.length)], true);
      else if (Math.random() < 0.25) match.cheerOn(seat.id, true);
    }
  }, 1200);
  match.crowdChanged(['Zoe', 'Ari', 'Lev', 'Kim', 'Ida', 'Mo', 'Pia', 'Ugo', 'Eda'].map((name, id) => ({ id, name })));
  benchYou();
  if (match.current > 0) setTimeout(() => shoot(match.current), LIVE_AIM_SECONDS[1] * 1000);
  return match;
}
