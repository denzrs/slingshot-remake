import { planShot, type Aim } from './ai';
import { AIM, PHYSICS, SCORING } from './config';
import { normalizeAngle, Shot, type ShotEnd, type ShotRules, type World } from './physics';
import { createRng, randomSeed, type Rng } from './rng';
import { scoreHit } from './scoring';
import type { Settings } from './settings';
import { generateWorld } from './world';

export type Phase = 'aiming' | 'flying' | 'roundOver' | 'gameOver';
export type PlayerId = 0 | 1;

export interface PlayerState {
  score: number;
  angle: number;
  power: number;
  /** Shots fired in the current round. */
  shots: number;
}

export interface Trail {
  owner: PlayerId;
  /** Flat [x0, y0, x1, y1, …] polyline in field units. */
  points: number[];
}

export interface RoundResult {
  kind: 'hit' | 'self';
  shooter: PlayerId;
  /** Player who receives the points. */
  winner: PlayerId;
  points: number;
  shots: number;
  power: number;
}

export type GameEvent =
  | { type: 'round' }
  | { type: 'fire'; player: PlayerId; x: number; y: number; angle: number; power: number }
  | { type: 'impact'; player: PlayerId; x: number; y: number }
  | { type: 'explode'; x: number; y: number; ship: PlayerId }
  | { type: 'fizzle'; player: PlayerId; x: number; y: number; lost: boolean }
  | { type: 'gameOver' };

export interface GameOptions {
  /** Attract mode: both ships are CPUs, rounds continue on their own, forever. */
  attract?: boolean;
}

const TRAIL_EVERY = 2;
const DEFAULT_ANGLE: Record<PlayerId, number> = { 0: 0, 1: 180 };

export class Game {
  world!: World;
  phase: Phase = 'aiming';
  round = 0;
  current: PlayerId = 0;
  players: [PlayerState, PlayerState] = [newPlayer(0), newPlayer(1)];
  trails: Trail[] = [];
  shot: Shot | null = null;
  shotTrail: Trail | null = null;
  result: RoundResult | null = null;
  /** Seconds spent in the current phase (real time). */
  phaseTime = 0;
  /** Rounds in this match (0 = endless) — fixed when the match starts. */
  totalRounds = 0;
  /** Whether planets are hidden this round — fixed when the round starts. */
  hiddenPlanets = false;

  private simClock = 0;
  private listeners: ((e: GameEvent) => void)[] = [];
  private rng: Rng = createRng(randomSeed());
  private cpu: { planner: Generator<void, Aim> | null; target: Aim | null; settle: number } = {
    planner: null,
    target: null,
    settle: 0,
  };

  constructor(
    public settings: Settings,
    private readonly options: GameOptions = {},
  ) {
    this.newMatch();
  }

  on(listener: (e: GameEvent) => void): void {
    this.listeners.push(listener);
  }

  isCpu(p: PlayerId): boolean {
    if (this.options.attract) return true;
    return p === 1 && this.settings.opponent === 'cpu';
  }

  get isHumanTurn(): boolean {
    return this.phase === 'aiming' && !this.isCpu(this.current);
  }

  get planetsVisible(): boolean {
    return !this.hiddenPlanets || this.phase === 'roundOver' || this.phase === 'gameOver';
  }

  get isLastRound(): boolean {
    return this.totalRounds > 0 && this.round >= this.totalRounds;
  }

  get leader(): PlayerId | null {
    const [a, b] = this.players;
    return a.score === b.score ? null : a.score > b.score ? 0 : 1;
  }

  newMatch(): void {
    this.players = [newPlayer(0), newPlayer(1)];
    this.round = 0;
    this.totalRounds = this.options.attract ? 0 : this.settings.rounds;
    this.startRound();
  }

  startRound(): void {
    this.round++;
    this.world = generateWorld(randomSeed(), this.settings.maxPlanets);
    this.hiddenPlanets = this.settings.invisiblePlanets;
    this.trails = [];
    this.shot = null;
    this.shotTrail = null;
    this.result = null;
    for (const id of [0, 1] as const) {
      const p = this.players[id];
      p.shots = 0;
      p.angle = DEFAULT_ANGLE[id];
      p.power = this.settings.fixedPower ? AIM.FIXED_POWER : AIM.DEFAULT_POWER;
    }
    // Alternate who opens each round.
    this.current = ((this.round - 1) % 2) as PlayerId;
    this.setPhase('aiming');
    this.emit({ type: 'round' });
  }

  /** Nudge the current player's aim (human input). */
  adjust(dAngle: number, dPower: number): void {
    if (!this.isHumanTurn) return;
    const p = this.players[this.current];
    this.setAim(p.angle + dAngle, p.power + dPower);
  }

  setAim(angle: number, power: number): void {
    const p = this.players[this.current];
    p.angle = normalizeAngle(angle);
    if (!this.settings.fixedPower) p.power = clamp(power, AIM.MIN_POWER, AIM.MAX_POWER);
  }

  /** Called when settings change mid-match. */
  applySettings(settings: Settings): void {
    this.settings = settings;
    if (settings.fixedPower) for (const p of this.players) p.power = AIM.FIXED_POWER;
    if (!this.isCpu(this.current)) this.resetCpu();
  }

  fire(): void {
    if (this.phase !== 'aiming') return;
    const id = this.current;
    const p = this.players[id];
    p.shots++;
    this.shot = new Shot(this.world, id, p.angle, p.power, this.rules());
    this.shotTrail = { owner: id, points: [this.shot.x, this.shot.y] };
    this.simClock = 0;
    this.resetCpu();
    this.setPhase('flying');
    this.emit({ type: 'fire', player: id, x: this.shot.x, y: this.shot.y, angle: p.angle, power: p.power });
  }

  /** Space / "continue": next round, final screen, or a new match. */
  advance(): void {
    if (this.phaseTime < 0.6) return;
    if (this.phase === 'roundOver') {
      if (this.isLastRound) {
        this.setPhase('gameOver');
        this.emit({ type: 'gameOver' });
      } else {
        this.startRound();
      }
    } else if (this.phase === 'gameOver') {
      this.newMatch();
    }
  }

  update(dt: number): void {
    this.phaseTime += dt;
    if (this.phase === 'flying') this.updateFlight(dt);
    else if (this.phase === 'aiming' && this.isCpu(this.current)) this.updateCpu(dt);
    else if (this.phase === 'roundOver' && this.options.attract && this.phaseTime > 3) this.advance();
  }

  private updateFlight(dt: number): void {
    const shot = this.shot!;
    const trail = this.shotTrail!;
    // Long flights speed up so nobody waits for an orbit to decay.
    const t = this.phaseTime;
    const speed = t < 3 ? 1 : Math.min(4, 1 + (t - 3) * 0.75);
    this.simClock += dt * speed;
    while (this.simClock >= PHYSICS.DT) {
      this.simClock -= PHYSICS.DT;
      const end = shot.step();
      if (end || Math.round(shot.time / PHYSICS.DT) % TRAIL_EVERY === 0) trail.points.push(shot.x, shot.y);
      if (end) {
        this.finishShot(end);
        return;
      }
    }
  }

  private finishShot(end: ShotEnd): void {
    const shot = this.shot!;
    this.trails.push(this.shotTrail!);
    this.shot = null;
    this.shotTrail = null;

    if (end.kind === 'ship') {
      const shooter = shot.shooter;
      const self = end.ship === shooter;
      const winner = (self ? 1 - shooter : shooter) as PlayerId;
      const shots = this.players[shooter].shots;
      const points = self ? SCORING.SELF_HIT : scoreHit(shots, shot.power, this.settings.fixedPower).points;
      this.players[winner].score += points;
      this.result = { kind: self ? 'self' : 'hit', shooter, winner, points, shots, power: shot.power };
      const ship = this.world.ships[end.ship];
      this.setPhase('roundOver');
      this.emit({ type: 'explode', x: ship.x, y: ship.y, ship: end.ship });
      return;
    }

    const player = shot.shooter;
    if (end.kind === 'planet') this.emit({ type: 'impact', player, x: shot.x, y: shot.y });
    else this.emit({ type: 'fizzle', player, x: shot.x, y: shot.y, lost: end.kind === 'lost' });
    this.current = (1 - this.current) as PlayerId;
    this.setPhase('aiming');
  }

  private updateCpu(dt: number): void {
    const cpu = this.cpu;
    if (!cpu.planner && !cpu.target) {
      cpu.planner = planShot(this.world, this.current, {
        rules: this.rules(),
        level: this.options.attract ? 'medium' : this.settings.cpuLevel,
        attempt: this.players[this.current].shots,
        fixedPower: this.settings.fixedPower ? AIM.FIXED_POWER : null,
        rng: this.rng,
      });
    }
    if (cpu.planner) {
      // Spend at most a few ms per frame thinking.
      const deadline = performance.now() + 6;
      while (performance.now() < deadline) {
        const r = cpu.planner.next();
        if (r.done) {
          cpu.target = r.value;
          cpu.planner = null;
          break;
        }
      }
      return;
    }
    // Swing the ship towards the chosen aim like a player would, then fire.
    if (this.phaseTime < 0.7) return;
    const p = this.players[this.current];
    const target = cpu.target!;
    const dA = ((target.angle - p.angle + 540) % 360) - 180;
    const dP = target.power - p.power;
    const stepA = 140 * dt;
    const stepP = 70 * dt;
    p.angle = normalizeAngle(Math.abs(dA) <= stepA ? target.angle : p.angle + Math.sign(dA) * stepA);
    p.power = Math.abs(dP) <= stepP ? target.power : p.power + Math.sign(dP) * stepP;
    if (p.angle === normalizeAngle(target.angle) && p.power === target.power) {
      cpu.settle += dt;
      if (cpu.settle > 0.35) this.fire();
    }
  }

  private resetCpu(): void {
    this.cpu = { planner: null, target: null, settle: 0 };
  }

  private rules(): ShotRules {
    return { bounce: this.settings.bounce, timeLimit: this.settings.shotTime };
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
  }

  private emit(e: GameEvent): void {
    for (const l of this.listeners) l(e);
  }
}

function newPlayer(id: PlayerId): PlayerState {
  return { score: 0, angle: DEFAULT_ANGLE[id], power: AIM.DEFAULT_POWER, shots: 0 };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
