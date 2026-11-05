import { buildSector, rankOf, sectorRules, type Challenge, type DailyShot, type Sector, type SectorSpec, type ThemeId } from '../sim/challenge';
import { AIM, CHALLENGE, FIELD } from '../sim/config';
import { cloneWorld, normalizeAngle, type ShotRules, type StyleKind } from '../sim/physics';
import { scoreChallengeHit } from '../sim/scoring';
import type { Settings } from '../data/settings';
import { thinTrail } from '../data/stats';
import type { VolleyAim, VolleyShot } from '../sim/volley';
import { Match, newPlayer, type KillRecord, type MatchOptions, type RoundTitle } from './match';
import type { ReplayTurn } from './replay';

export interface ShotLog {
  kind: 'hit' | 'miss' | 'self';
  /** Points of this shot (negative for a self-hit). */
  points: number;
  combo: StyleKind[];
  multiplier: number;
}

export interface SectorResult {
  index: number;
  targets: number;
  /** Shots the sector allowed. */
  budget: number;
  cleared: boolean;
  shots: ShotLog[];
  /** Everything the sector paid, clear bonus included. */
  points: number;
  bonus: number;
}

/** Everything the result screen, the share text and the highscore store need. */
export interface ChallengeResult {
  dateKey: string;
  number: number;
  theme: ThemeId;
  total: number;
  /** 0 … 5, see `CHALLENGE.RANKS`. */
  rank: number;
  sectors: SectorResult[];
}

/**
 * The daily challenge: one human, a handful of stationary target drones, a limited number of shots,
 * sector after sector. Nothing here is random — the sectors come from the date — so the score is a
 * pure function of how well you shoot.
 */
export class ChallengeMatch extends Match {
  readonly mode = 'challenge';
  spec!: SectorSpec;
  /** Shots left in this sector. */
  shotsLeft = 0;
  /** Sector results so far (one per finished sector). */
  results: SectorResult[] = [];
  /** The shot of this run that paid the most: it goes along when the run is posted. Null until something is hit. */
  bestShot: DailyShot | null = null;

  private user: Settings;
  private readonly sectors = new Map<number, Sector>();
  /** Shots spent since the last target went down — the shot factor of the next hit. */
  protected attempt = 0;
  private log: ShotLog[] = [];
  private volleyKill: KillRecord | null = null;
  /** The shot in the air, as it was fired. */
  private fired: Omit<DailyShot, 'points' | 'trail'> | null = null;

  constructor(
    settings: Settings,
    readonly challenge: Challenge,
    options: MatchOptions = {},
  ) {
    super(settings, options);
    this.user = settings;
  }

  get rules(): ShotRules {
    return sectorRules(this.spec);
  }

  protected get survivorBonus(): number {
    return 0;
  }

  /** Your own ship. */
  get pilot() {
    return this.players[0];
  }

  /** Targets still standing. */
  get targetsLeft(): number {
    return this.players.filter((p) => p.target && p.alive).length;
  }

  get targetsTotal(): number {
    return this.players.filter((p) => p.target).length;
  }

  get total(): number {
    return this.pilot.score;
  }

  result(): ChallengeResult {
    const { dateKey, number, theme } = this.challenge;
    return { dateKey, number, theme, total: this.total, rank: rankOf(this.total, this.challenge), sectors: this.results };
  }

  /** The rounds before the first one this match plays. */
  protected get roundsBefore(): number {
    return 0;
  }

  newMatch(): void {
    this.round = this.roundsBefore;
    this.clock = 0;
    this.killFeed = [];
    this.results = [];
    this.bestShot = null;
    this.totalRounds = this.challenge.sectors.length;
    this.teamMode = 0;
    this.startRound();
  }

  startRound(): void {
    this.killcam.reset();
    this.round++;
    const sector = this.sector(this.round - 1);
    this.spec = sector.spec;
    this.worldSeed = this.spec.seed;
    this.world = cloneWorld(sector.world);
    const carried = this.players[0]?.score ?? 0;
    // A retry starts from zero, not from the last run's score.
    const score = this.round === 1 ? 0 : carried;
    this.players = this.world.ships.map((_, id) => newPlayer(id, id, id === 0 ? 'human' : 'easy', null, id > 0));
    this.pilot.score = score;
    this.settings = this.effectiveSettings();
    this.hiddenPlanets = this.spec.invisible;
    this.trails = [];
    this.volley = null;
    this.summary = null;
    this.lastKill = null;
    this.volleyKill = null;
    this.shotsLeft = this.spec.shots;
    this.attempt = 0;
    this.log = [];
    const ship = this.world.ships[0];
    this.pilot.angle = normalizeAngle(Math.round((Math.atan2(ship.y - FIELD.height / 2, FIELD.width / 2 - ship.x) * 180) / Math.PI));
    this.pilot.power = this.settings.fixedPower ? AIM.FIXED_POWER : AIM.DEFAULT_POWER;
    this.emit({ type: 'round' });
    this.beginRound();
  }

  applySettings(settings: Settings): void {
    this.user = { ...this.user, contours: settings.contours };
    this.settings = this.effectiveSettings();
  }

  /** The sector's own rules win over whatever the player has set up for free play. */
  private effectiveSettings(): Settings {
    return { ...this.user, maxPower: AIM.MAX_POWER, fixedPower: this.spec.fixedPower, bounce: this.spec.bounce, invisiblePlanets: this.spec.invisible };
  }

  private sector(index: number): Sector {
    let sector = this.sectors.get(index);
    if (!sector) {
      sector = buildSector(this.challenge.sectors[index]);
      this.sectors.set(index, sector);
    }
    return sector;
  }

  protected beginRound(): void {
    this.current = 0;
    this.setPhase('aiming');
    this.emit({ type: 'turn', player: 0 });
  }

  commit(): void {
    if (this.isHumanTurn) this.fire();
  }

  protected fire(): void {
    const p = this.pilot;
    p.shots++;
    this.attempt++;
    this.shotsLeft--;
    this.volleyKill = null;
    this.fired = {
      sector: this.spec.index,
      down: this.players.filter((other) => other.target && !other.alive).map((other) => other.id),
      attempt: this.attempt,
      left: this.shotsLeft,
      angle: p.angle,
      power: p.power,
    };
    // The sector's ammo: plasma bends little and ignores clouds.
    const aim: VolleyAim = { player: 0, angle: p.angle, power: p.power, ...(this.spec.ammo === 'plasma' ? { plasma: true } : {}) };
    this.launch([aim], true);
  }

  protected updatePhase(_dt: number): void {}

  protected killPoints(vs: VolleyShot): { points: number; combo: StyleKind[]; multiplier: number } {
    const kinds = (vs.shot.style ?? []).map((e) => e.kind);
    const { points, multiplier } = scoreChallengeHit(this.attempt, vs.shot.power, this.settings.fixedPower, kinds);
    return { points, combo: kinds, multiplier };
  }

  protected recordKill(record: KillRecord): void {
    this.volleyKill = record;
    super.recordKill(record);
  }

  protected afterVolley(): void {
    const kill = this.volleyKill;
    this.log.push({
      kind: !kill ? 'miss' : kill.self ? 'self' : 'hit',
      points: kill?.points ?? 0,
      combo: kill?.combo ?? [],
      multiplier: kill?.multiplier ?? 1,
    });
    if (kill && !kill.self) {
      this.attempt = 0;
      if (kill.points > (this.bestShot?.points ?? 0)) this.noteBest(kill.points);
    }

    if (kill?.self) return this.finishSector('selfHit');
    if (this.targetsLeft === 0) return this.finishSector('cleared');
    if (this.shotsLeft <= 0) return this.finishSector('outOfShots');
    this.beginRound();
  }

  private noteBest(points: number): void {
    // A flak cannon's stray missiles fly for the targets' side: the pilot's own path is the last of theirs.
    const flown = [...this.trails].reverse().find((trail) => trail.owner === 0)?.points;
    if (!this.fired || !flown) return;
    const every = Math.ceil(flown.length / 2 / (CHALLENGE.SHOT_TRAIL - 1));
    this.bestShot = { ...this.fired, points, trail: thinTrail(flown, every) };
  }

  private finishSector(title: RoundTitle): void {
    const cleared = title === 'cleared';
    const bonus = cleared ? CHALLENGE.CLEAR_BONUS : 0;
    this.pilot.score += bonus;
    this.results.push({
      index: this.spec.index,
      targets: this.targetsTotal,
      budget: this.spec.shots,
      cleared,
      shots: this.log,
      points: this.log.reduce((sum, s) => sum + s.points, 0) + bonus,
      bonus,
    });
    this.summary = { title, survivor: null, team: null, bonus, lastKill: this.lastKill };
    this.current = -1;
    this.setPhase('roundOver');
    this.emit({ type: 'roundEnd' });
  }

  protected roundTitle(): RoundTitle {
    return 'cleared';
  }
}

/** The shot of a day flown again on the full field: its sector as it stood, the shot, and no more. */
export class ShotReplay extends ChallengeMatch {
  /** When the shot hit, in phase time. Null until it does. */
  private landedAt: number | null = null;
  private holdSkipped = false;

  constructor(
    settings: Settings,
    challenge: Challenge,
    readonly shot: DailyShot & { name: string },
  ) {
    const { sector, angle, power } = shot;
    super(settings, challenge, { script: { turns: [{ round: sector + 1, turn: 1, placements: [], shots: [{ player: 0, angle, power, rider: null, splitAt: null }] }] } });
  }

  protected get roundsBefore(): number {
    return this.shot.sector;
  }

  protected beginRound(): void {
    this.landedAt = null;
    this.holdSkipped = false;
    for (const id of this.shot.down) {
      if (!this.players[id]?.target) continue;
      this.players[id].alive = false;
      this.world.ships[id].alive = false;
    }
    // The hit pays what it paid: the shot's factor comes from the shots before it.
    this.attempt = this.shot.attempt - 1;
    this.shotsLeft = this.shot.left + 1;
    this.pilot.angle = this.shot.angle;
    this.pilot.power = this.shot.power;
    super.beginRound();
  }

  protected playTurn(turn: ReplayTurn): void {
    if (this.stageTurn(turn, [this.pilot])) this.fire();
  }

  protected recordKill(record: KillRecord): void {
    this.landedAt = this.phaseTime;
    super.recordKill(record);
  }

  /** The end card waits for the hit's moment, which stray missiles may already have used up; a miss gets it once the flight has ended. */
  protected get afterVolleyDelay(): number {
    if (this.holdSkipped) return 0;
    return CHALLENGE.SHOT_LINGER - (this.landedAt === null ? 0 : this.flightDoneAt! - this.landedAt);
  }

  skipHold(): boolean {
    if (this.phase !== 'flying' || this.flightDoneAt === null) return false;
    this.holdSkipped = true;
    return true;
  }

  /** One shot is all there is. */
  protected afterVolley(): void {
    this.current = -1;
    this.setPhase('gameOver');
    this.emit({ type: 'gameOver' });
  }
}
