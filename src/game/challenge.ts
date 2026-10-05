import { buildSector, rankOf, sectorRules, type Challenge, type Sector, type SectorSpec, type ThemeId } from '../challenge';
import { AIM, CHALLENGE, FIELD } from '../config';
import { cloneWorld, normalizeAngle, type ShotRules, type StyleKind } from '../physics';
import { scoreChallengeHit } from '../scoring';
import type { Settings } from '../settings';
import type { VolleyShot } from '../volley';
import { Match, newPlayer, type KillRecord, type RoundTitle } from './match';

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

  private user: Settings;
  private readonly sectors = new Map<number, Sector>();
  /** Shots spent since the last target went down — the shot factor of the next hit. */
  private attempt = 0;
  private log: ShotLog[] = [];
  private volleyKill: KillRecord | null = null;

  constructor(
    settings: Settings,
    readonly challenge: Challenge,
  ) {
    super(settings);
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

  newMatch(): void {
    this.round = 0;
    this.clock = 0;
    this.killFeed = [];
    this.results = [];
    this.totalRounds = this.challenge.sectors.length;
    this.teamMode = 0;
    this.startRound();
  }

  startRound(): void {
    this.round++;
    const sector = this.sector(this.round - 1);
    this.spec = sector.spec;
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
    return { ...this.user, fixedPower: this.spec.fixedPower, bounce: this.spec.bounce, invisiblePlanets: this.spec.invisible };
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
    if (!this.isHumanTurn) return;
    const p = this.pilot;
    p.shots++;
    this.attempt++;
    this.shotsLeft--;
    this.volleyKill = null;
    this.launch([{ player: 0, angle: p.angle, power: p.power }], true);
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
    if (kill && !kill.self) this.attempt = 0;

    if (kill?.self) return this.finishSector('selfHit');
    if (this.targetsLeft === 0) return this.finishSector('cleared');
    if (this.shotsLeft <= 0) return this.finishSector('outOfShots');
    this.beginRound();
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
