import { planShot, type Aim } from './ai';
import { AIM, PHYSICS, SCORING } from './config';
import { normalizeAngle, Shot, type ShotEnd, type ShotRules, type World } from './physics';
import { createRng, randomSeed, type Rng } from './rng';
import { scoreHit } from './scoring';
import type { Settings } from './settings';
import { generateWorld } from './world';

export type Phase = 'aiming' | 'flying' | 'roundOver' | 'gameOver';
export type PlayerId = number;
export type TeamId = 0 | 1;

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
  target: PlayerId;
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
  attract?: boolean;
  playerCount?: number;
  mode?: 'ffa' | 'team';
  localPlayerId?: PlayerId;
  seed?: number;
  network?: boolean;
}

export interface GameSnapshot {
  mode: 'ffa' | 'team';
  phase: Phase;
  round: number;
  current: PlayerId;
  players: PlayerState[];
  world: World;
  trails: Trail[];
  shot: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    time: number;
    shooter: number;
    angle: number;
    power: number;
    end: ShotEnd | null;
  } | null;
  shotTrail: Trail | null;
  result: RoundResult | null;
  phaseTime: number;
  totalRounds: number;
  hiddenPlanets: boolean;
  settings: Settings;
}

const TRAIL_EVERY = 2;

function defaultAngle(id: number, count: number): number {
  const shipAngle = Math.PI + (id / count) * Math.PI * 2;
  return normalizeAngle((Math.atan2(Math.sin(shipAngle), -Math.cos(shipAngle)) * 180) / Math.PI);
}

export class Game {
  world!: World;
  phase: Phase = 'aiming';
  round = 0;
  current: PlayerId = 0;
  players: PlayerState[] = [];
  readonly mode: 'ffa' | 'team';
  readonly playerCount: number;
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
  private listeners: ((event: GameEvent) => void)[] = [];
  private rng: Rng;
  private cpu: { planner: Generator<void, Aim> | null; target: Aim | null; settle: number } = {
    planner: null,
    target: null,
    settle: 0,
  };

  constructor(
    public settings: Settings,
    private readonly options: GameOptions = {},
  ) {
    this.playerCount = Math.max(2, Math.min(6, Math.floor(options.playerCount ?? 2)));
    this.mode = options.mode ?? 'ffa';
    this.rng = createRng(options.seed ?? randomSeed());
    this.newMatch();
  }

  snapshot(): GameSnapshot {
    return {
      mode: this.mode,
      phase: this.phase,
      round: this.round,
      current: this.current,
      players: this.players.map((player) => ({ ...player })),
      world: this.world,
      trails: this.trails,
      shot: this.shot ? {
        x: this.shot.x,
        y: this.shot.y,
        vx: this.shot.vx,
        vy: this.shot.vy,
        time: this.shot.time,
        shooter: this.shot.shooter,
        angle: this.shot.angle,
        power: this.shot.power,
        end: this.shot.end,
      } : null,
      shotTrail: this.shotTrail,
      result: this.result,
      phaseTime: this.phaseTime,
      totalRounds: this.totalRounds,
      hiddenPlanets: this.hiddenPlanets,
      settings: this.settings,
    };
  }

  restoreSnapshot(snapshot: GameSnapshot): void {
    if (snapshot.mode !== this.mode || snapshot.players.length !== this.playerCount || snapshot.world.ships.length !== this.playerCount) return;
    this.settings = snapshot.settings;
    this.phase = snapshot.phase;
    this.round = snapshot.round;
    this.current = snapshot.current;
    this.players = snapshot.players.map((player) => ({ ...player }));
    this.world = snapshot.world;
    this.trails = snapshot.trails;
    this.shot = null;
    if (snapshot.shot) {
      this.shot = new Shot(snapshot.world, snapshot.shot.shooter, snapshot.shot.angle, snapshot.shot.power, this.rules());
      Object.assign(this.shot, {
        x: snapshot.shot.x,
        y: snapshot.shot.y,
        vx: snapshot.shot.vx,
        vy: snapshot.shot.vy,
        time: snapshot.shot.time,
        end: snapshot.shot.end,
      });
    }
    this.shotTrail = snapshot.shotTrail;
    this.result = snapshot.result;
    this.phaseTime = snapshot.phaseTime;
    this.totalRounds = snapshot.totalRounds;
    this.hiddenPlanets = snapshot.hiddenPlanets;
  }

  /** Dispatch host-authoritative events to rendering and audio listeners. */
  applyRemoteEvent(event: GameEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  on(listener: (event: GameEvent) => void): void {
    this.listeners.push(listener);
  }

  isCpu(id: PlayerId): boolean {
    if (this.options.network) return false;
    if (this.options.attract) return true;
    return this.playerCount === 2 && id === 1 && this.settings.opponent === 'cpu';
  }

  get isHumanTurn(): boolean {
    return this.phase === 'aiming' && !this.isCpu(this.current) &&
      (this.options.localPlayerId === undefined || this.current === this.options.localPlayerId);
  }
  get isRemoteTurn(): boolean {
    return this.options.network === true && this.options.localPlayerId !== undefined && this.current !== this.options.localPlayerId;
  }

  get planetsVisible(): boolean {
    return !this.hiddenPlanets || this.phase === 'roundOver' || this.phase === 'gameOver';
  }

  get isLastRound(): boolean {
    return this.totalRounds > 0 && this.round >= this.totalRounds;
  }

  get leader(): PlayerId | null {
    if (this.mode === 'team') return null;
    let leader = 0;
    let tied = false;
    for (let id = 1; id < this.players.length; id++) {
      if (this.players[id].score > this.players[leader].score) {
        leader = id;
        tied = false;
      } else if (this.players[id].score === this.players[leader].score) {
        tied = true;
      }
    }
    return tied ? null : leader;
  }

  teamOf(id: PlayerId): TeamId {
    return (id % 2) as TeamId;
  }

  get teamScores(): [number, number] {
    const totals: [number, number] = [0, 0];
    this.players.forEach((player, id) => (totals[this.teamOf(id)] += player.score));
    return totals;
  }

  get winningTeam(): TeamId | null {
    if (this.mode !== 'team') return null;
    const [a, b] = this.teamScores;
    return a === b ? null : a > b ? 0 : 1;
  }

  newMatch(): void {
    this.players = Array.from({ length: this.playerCount }, (_, id) => ({
      score: 0,
      angle: defaultAngle(id, this.playerCount),
      power: AIM.DEFAULT_POWER,
      shots: 0,
    }));
    this.round = 0;
    this.totalRounds = this.options.attract ? 0 : this.settings.rounds;
    this.startRound();
  }

  startRound(): void {
    this.round++;
    this.world = generateWorld(Math.floor(this.rng() * 2 ** 31), this.settings.maxPlanets, this.playerCount);
    this.hiddenPlanets = this.settings.invisiblePlanets;
    this.trails = [];
    this.shot = null;
    this.shotTrail = null;
    this.result = null;
    for (let id = 0; id < this.players.length; id++) {
      const player = this.players[id];
      player.shots = 0;
      player.angle = defaultAngle(id, this.playerCount);
      player.power = this.settings.fixedPower ? AIM.FIXED_POWER : AIM.DEFAULT_POWER;
    }
    this.current = (this.round - 1) % this.playerCount;
    this.setPhase('aiming');
    this.emit({ type: 'round' });
  }

  adjust(dAngle: number, dPower: number): void {
    if (this.isHumanTurn) this.adjustFor(this.current, dAngle, dPower);
  }

  adjustFor(id: PlayerId, dAngle: number, dPower: number): void {
    if (this.phase !== 'aiming' || id !== this.current || this.isCpu(id)) return;
    const player = this.players[id];
    this.setAimFor(id, player.angle + dAngle, player.power + dPower);
  }

  setAim(angle: number, power: number): void {
    if (this.isHumanTurn) this.setAimFor(this.current, angle, power);
  }

  setAimFor(id: PlayerId, angle: number, power: number): void {
    if (this.phase !== 'aiming' || id !== this.current || this.isCpu(id)) return;
    const player = this.players[id];
    player.angle = normalizeAngle(angle);
    if (!this.settings.fixedPower) player.power = clamp(power, AIM.MIN_POWER, AIM.MAX_POWER);
  }

  applySettings(settings: Settings): void {
    this.settings = settings;
    if (settings.fixedPower) for (const player of this.players) player.power = AIM.FIXED_POWER;
    if (!this.isCpu(this.current)) this.resetCpu();
  }

  fire(): void {
    if (this.phase === 'aiming' && (this.isHumanTurn || this.isCpu(this.current))) this.fireFor(this.current);
  }

  fireFor(id: PlayerId): void {
    if (this.phase !== 'aiming' || id !== this.current) return;
    if (this.isCpu(id) && !this.options.attract) return;
    const player = this.players[id];
    player.shots++;
    this.shot = new Shot(this.world, id, player.angle, player.power, this.rules());
    this.shotTrail = { owner: id, points: [this.shot.x, this.shot.y] };
    this.simClock = 0;
    this.resetCpu();
    this.setPhase('flying');
    this.emit({ type: 'fire', player: id, x: this.shot.x, y: this.shot.y, angle: player.angle, power: player.power });
  }

  advance(): void {
    if (this.options.network && this.options.localPlayerId !== 0) return;
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
    if (this.options.network && this.options.localPlayerId !== 0) return;
    this.phaseTime += dt;
    if (this.phase === 'flying') this.updateFlight(dt);
    else if (this.phase === 'aiming' && this.isCpu(this.current)) this.updateCpu(dt);
    else if (this.phase === 'roundOver' && this.options.attract && this.phaseTime > 3) this.advance();
  }

  private updateFlight(dt: number): void {
    const shot = this.shot!;
    const trail = this.shotTrail!;
    const speed = this.phaseTime < 3 ? 1 : Math.min(4, 1 + (this.phaseTime - 3) * 0.75);
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
      const target = end.ship;
      const self = target === shooter;
      const winner = self ? (shooter + 1) % this.playerCount : shooter;
      const shots = this.players[shooter].shots;
      const points = self ? SCORING.SELF_HIT : scoreHit(shots, shot.power, this.settings.fixedPower).points;
      this.players[winner].score += points;
      this.result = { kind: self ? 'self' : 'hit', shooter, target, winner, points, shots, power: shot.power };
      const ship = this.world.ships[target];
      this.setPhase('roundOver');
      this.emit({ type: 'explode', x: ship.x, y: ship.y, ship: target });
      return;
    }

    const player = shot.shooter;
    if (end.kind === 'planet') this.emit({ type: 'impact', player, x: shot.x, y: shot.y });
    else this.emit({ type: 'fizzle', player, x: shot.x, y: shot.y, lost: end.kind === 'lost' });
    this.current = (this.current + 1) % this.playerCount;
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
      const deadline = performance.now() + 6;
      while (performance.now() < deadline) {
        const result = cpu.planner.next();
        if (result.done) {
          cpu.target = result.value;
          cpu.planner = null;
          break;
        }
      }
      return;
    }
    if (this.phaseTime < 0.7) return;
    const player = this.players[this.current];
    const target = cpu.target!;
    const deltaAngle = ((target.angle - player.angle + 540) % 360) - 180;
    const deltaPower = target.power - player.power;
    const stepAngle = 140 * dt;
    const stepPower = 70 * dt;
    player.angle = normalizeAngle(Math.abs(deltaAngle) <= stepAngle ? target.angle : player.angle + Math.sign(deltaAngle) * stepAngle);
    player.power = Math.abs(deltaPower) <= stepPower ? target.power : player.power + Math.sign(deltaPower) * stepPower;
    if (player.angle === normalizeAngle(target.angle) && player.power === target.power) {
      cpu.settle += dt;
      if (cpu.settle > 0.35) this.fireFor(this.current);
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

  private emit(event: GameEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
