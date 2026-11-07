import { createMatch, type Match } from '../game';
import { DEFAULT_SETTINGS } from '../data/settings';
import type { Anomaly } from '../sim/config';

/** Dev-only screens opened with ?preview=oracle-card|oracle-pause|stands-card|stands-pause|card-marks|mayhem-anomalies|mayhem-extreme. */
export type UiPreview = 'oracle-card' | 'oracle-pause' | 'stands-card' | 'stands-pause' | 'card-marks' | 'mayhem-anomalies' | 'mayhem-extreme';

export const UI_PREVIEWS: readonly UiPreview[] = ['oracle-card', 'oracle-pause', 'stands-card', 'stands-pause', 'card-marks', 'mayhem-anomalies', 'mayhem-extreme'];

const ORACLE_SCORES = [
  { player: 0, points: 420, right: 3, total: 5 },
  { player: 1, points: 610, right: 4, total: 6 },
  { player: 2, points: 210, right: 2, total: 4 },
];

/** A reproducible six-ship online match with one eliminated, broke human and a live round bet. */
export function createUiPreview(mode: UiPreview): Match {
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
    oracle: true,
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
  const matchScores = [0, 2500, 3250, 2930, 2220, 1720];
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

  match.oracle.open('shot', 1, []);
  match.oracle.openRound(alive, false);
  const roundId = match.oracle.roundQuestion!.id;
  match.oracle.betRound(0, 2, alive, alive.length);
  match.oracle.betRound(1, 2, alive, alive.length);
  match.oracle.setStake(1, 250);
  match.players[1].score -= 250;
  match.oracle.roundMine = { id: roundId, pick: 2 };
  for (const { player, points, right, total } of ORACLE_SCORES) {
    Object.assign(match.oracle.scores[player], { points, right, total });
  }

  if (mode.startsWith('stands-')) {
    match.crowd.seats = [{ id: 0, name: 'Tess', balance: 500, present: true }];
    match.stands.open('shot', 1, []);
    match.stands.openRound(alive, false);
    const standsRoundId = match.stands.roundQuestion!.id;
    match.stands.betRound(0, 2, alive, alive.length);
    match.stands.setStake(0, 250);
    match.crowd.seats[0].balance -= 250;
    match.stands.roundMine = { id: standsRoundId, pick: 2 };
    Object.assign(match.stands.scores[0], { points: 180, right: 2, total: 3 });
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
