import { bountyPoints, underdogPoints } from '../sim/scoring';
import { SCORING, type BonusKind } from '../sim/config';
import type { Bonus, Mark, MarkKind, MarkState, PlayerState } from './match-types';

/** What the ledger reads of the match it keeps the books of. */
export interface LedgerDeps {
  players(): PlayerState[];
  /** What every point of this round is worth (a jackpot round pays and costs double). */
  payFactor(): number;
  friendsOf(id: number): number[];
  /** Whether the cards show marks right now: while aiming, in a game whose kills pay extras, in a round not settled by a walkover. */
  marksOpen(): boolean;
}

type Extra = { kind: Exclude<MarkKind, 'chain'>; points: number };
type Standing = { id: number; score: number };

/**
 * Who shot whom, in this round and the ones before, and the scores the round and the volley began with: what the extras a kill
 * pays (first blood, the chain, the bounty, revenge and the rest) are read from, and so are the marks on the cards, which tell the
 * shooter what each kill would pay. The payout and the marks read the same rules (`targetExtras`), so they cannot differ.
 */
export class KillLedger {
  /** The enemies each player has taken in the round being played, for the multi-kill chain. */
  private chain = new Map<number, number>();
  /** Whether an enemy ship has been taken this round yet: the first one is first blood. */
  private firstBlood = false;
  /** Who shot each ship down this round, and in the rounds before, latest first (revenge and domination read them). */
  private killedBy = new Map<number, number>();
  private killedBefore: Map<number, number>[] = [];
  /** Everybody's score as the volley in the air went up (the bounty and the underdog read it), and as the round began (the comeback). */
  private launchScores: number[] = [];
  private roundScores: number[] = [];

  constructor(private readonly deps: LedgerDeps) {}

  /** A new match: nobody has shot anybody. */
  newMatch(): void {
    this.killedBy.clear();
    this.killedBefore = [];
  }

  /**
   * A round begins. The chain counts a round's kills: several in one turn (a splitter's forks, an armor-piercing round) or one per turn
   * adding up, so no round opens with a chain carried in. Who shot you down last round is the one revenge is taken on in this one;
   * domination looks two rounds further back.
   */
  startRound(): void {
    this.chain.clear();
    this.firstBlood = false;
    this.killedBefore = [this.killedBy, ...this.killedBefore].slice(0, SCORING.DOMINATION_ROUNDS);
    this.killedBy = new Map();
  }

  /** The round's field is laid, with whatever the stakes of the last one gave back: everybody's score as the round begins. */
  scoresAtStart(scores: number[]): void {
    this.roundScores = scores;
  }

  /** The round is skipped: it is as if it was never played, for revenge and domination. */
  rollbackRound(): void {
    this.killedBy = this.killedBefore.shift() ?? new Map();
  }

  /** A volley goes up. */
  launched(scores: number[]): void {
    this.launchScores = scores;
  }

  /** An enemy ship was shot down: the round has had its first blood, and the victim knows who did it. */
  noteKill(killer: number, victim: number): void {
    this.firstBlood = true;
    this.killedBy.set(victim, killer);
  }

  /** The killer has taken one more enemy this round: how many that makes, and what it pays on top (`share` of it). */
  extendChain(killer: number, share: number): { kills: number; points: number } {
    const kills = (this.chain.get(killer) ?? 0) + 1;
    this.chain.set(killer, kills);
    return { kills, points: Math.round(SCORING.MULTI_KILL[Math.min(kills, SCORING.MULTI_KILL.length - 1)] * this.deps.payFactor() * share) };
  }

  /** The extras a kill of an enemy pays, taken before the kill is noted (it is no longer the round's first after that). */
  killBonuses(killer: number, victim: number, stray: boolean): Bonus[] {
    const players = this.deps.players();
    const pay = this.deps.payFactor();
    const bonuses: Bonus[] = [];
    const add = (kind: BonusKind, points: number) => {
      if (points > 0) bonuses.push({ kind, points });
    };
    if (!this.firstBlood) add('firstBlood', SCORING.FIRST_BLOOD * pay);
    bonuses.push(...this.targetExtras(killer, victim, this.standingsAtLaunch()));
    // Posthumous is for a ship that was shot down, not one whose player left the game with the shot in the air.
    if (!players[killer].alive && !players[killer].left) add('posthumous', SCORING.POSTHUMOUS * pay);
    // Once for the first shot, however many ships it takes: the chain is still empty for the first of them.
    if (!stray && players[killer].shots === 1 && !this.chain.has(killer)) add('opener', SCORING.OPENER * pay);
    return bonuses;
  }

  /**
   * The extras a kill pays for who the victim is, read from the `standings` it is taken at (the cards read the ones of the moment, the payout those of the launch).
   * Without a `killer` only what is true of the victim for everybody is left: the bounty and a shutdown.
   */
  private targetExtras(killer: number | null, victim: number, standings: Standing[]): Extra[] {
    const players = this.deps.players();
    const pay = this.deps.payFactor();
    const bonuses: Extra[] = [];
    const add = (kind: Extra['kind'], points: number) => {
      if (points > 0) bonuses.push({ kind, points });
    };
    /** Whether `by` shot `ship` down in each of the last `rounds` rounds before this one. */
    const shotDownBy = (ship: number, by: number, rounds: number) => this.killedBefore.length >= rounds && this.killedBefore.slice(0, rounds).every((round) => round.get(ship) === by);
    // Not times the jackpot, these two: the points of the lead and the gap they are a share of were paid at the round's rate already.
    if (standings[0]?.id === victim && standings[1]) add('bounty', bountyPoints(standings[0].score - standings[1].score));
    const last = standings.at(-1)!;
    const victimScore = standings.find((s) => s.id === victim)?.score;
    if (killer !== null && standings.length >= 3 && last.id === killer && last.score < standings.at(-2)!.score && victimScore !== undefined) add('underdog', underdogPoints(victimScore - last.score));
    // Revenge on the one who shot you down last round — double on one who did it the last few rounds running.
    if (killer !== null && shotDownBy(killer, victim, 1)) add('revenge', SCORING.REVENGE * pay * (shotDownBy(killer, victim, SCORING.DOMINATION_ROUNDS) ? 2 : 1));
    if (killer !== null && shotDownBy(victim, killer, SCORING.DOMINATION_ROUNDS - 1)) add('domination', SCORING.DOMINATION * pay);
    const spree = this.chain.get(victim) ?? 0;
    if (spree >= 2) add('shutdown', SCORING.SHUTDOWN_PER_KILL * spree * pay);
    const team = killer === null ? null : players[killer].team;
    if (killer !== null && team !== null && [...this.killedBy].some(([ship, by]) => by === victim && ship !== killer && players[ship].team === team)) add('avenger', SCORING.AVENGER * pay);
    return bonuses;
  }

  /** Everybody still in the game by their score as the volley went up, best first. Whoever left the game is not in the race. */
  private standingsAtLaunch(): Standing[] {
    return this.standings((p) => this.launchScores[p.id] ?? p.score);
  }

  private standings(score: (p: PlayerState) => number): Standing[] {
    return this.deps.players().flatMap((p) => (p.left ? [] : [{ id: p.id, score: score(p) }])).sort((a, b) => b.score - a.score);
  }

  /** The ship that was alone in last place as the round began: winning the round from there pays a comeback. */
  comebackCandidate(): number | null {
    const field = this.deps.players().filter((p) => !p.left).sort((a, b) => (this.roundScores[a.id] ?? 0) - (this.roundScores[b.id] ?? 0));
    return field.length >= 2 && (this.roundScores[field[0].id] ?? 0) < (this.roundScores[field[1].id] ?? 0) ? field[0].id : null;
  }

  /** What the guests read their marks from (see `MarkState`). */
  state(): MarkState {
    return {
      chain: [...this.chain],
      firstBlood: this.firstBlood,
      killedBy: [...this.killedBy],
      before: this.killedBefore.map((round) => [...round]),
      roundScores: this.roundScores,
    };
  }

  restore(state: MarkState | undefined): void {
    if (!state) return;
    this.chain = new Map(state.chain);
    this.firstBlood = state.firstBlood;
    this.killedBy = new Map(state.killedBy);
    this.killedBefore = state.before.map((round) => new Map(round));
    this.roundScores = [...state.roundScores];
  }

  /** The marks on each ship's card, by ship, as `shooter` (or the stands, for null) sees them. The payout reads the same rules (`targetExtras`). */
  marksFor(shooter: number | null): Mark[][] {
    const players = this.deps.players();
    const marks: Mark[][] = players.map(() => []);
    if (!this.deps.marksOpen()) return marks;
    const pay = this.deps.payFactor();
    const me = shooter === null ? null : players[shooter];
    // A shooter who is out of the round, or away, has no kills to plan: they see what is true for everybody.
    const aiming = me !== null && me.alive && !me.away && !me.left ? me : null;
    const standings = this.standings((p) => p.score);
    const comeback = this.comebackCandidate();
    for (const p of players) {
      if (!p.alive || p.away || p.left) continue;
      const here = marks[p.id];
      if (aiming && p.id === aiming.id) {
        if (!this.firstBlood) here.push({ kind: 'firstBlood', points: SCORING.FIRST_BLOOD * pay });
        if (aiming.shots === 0 && !this.chain.has(aiming.id)) here.push({ kind: 'opener', points: SCORING.OPENER * pay });
        const next = (this.chain.get(aiming.id) ?? 0) + 1;
        const chain = SCORING.MULTI_KILL[Math.min(next, SCORING.MULTI_KILL.length - 1)] * pay;
        if (chain > 0) here.push({ kind: 'chain', points: chain });
      } else if (!aiming || !this.deps.friendsOf(aiming.id).includes(p.id)) {
        here.push(...this.targetExtras(aiming ? aiming.id : null, p.id, standings));
      }
      if (p.id === comeback) here.push({ kind: 'comeback', points: SCORING.COMEBACK * pay });
    }
    return marks;
  }
}
