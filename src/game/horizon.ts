import { HORIZON, PHYSICS, SCORING, COLORS } from '../config';
import { t } from '../i18n';
import { cloneWorld, type ShotRules, type StyleKind, type World } from '../physics';
import { scoreHorizonKill } from '../scoring';
import { Volley, type VolleyAim, type VolleyShot } from '../volley';
import { Match, type Camera, type KillRecord, type Phase, type RoundTitle, type Scene } from './match';

/** Everything needed to replay one kill exactly — the physics is deterministic. */
export interface KillcamClip {
  snapshot: World;
  aims: VolleyAim[];
  /** Index of the killing shot within the volley. */
  focus: number;
  victim: number;
  /** Simulation step at which the kill happened. */
  killStep: number;
  record: KillRecord;
}

interface KillcamState {
  clip: KillcamClip;
  replay: Volley;
  simClock: number;
  /** Seconds spent after the kill, holding on the explosion. */
  hold: number;
  camera: Camera;
  /** Phase to return to afterwards (replays started from the round summary); null = continue the volley. */
  returnTo: Phase | null;
  recording: boolean;
}

interface Drift {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Falls into the hole during this collapse. */
  lost: boolean;
}

interface CollapseState {
  fromRadius: number;
  toRadius: number;
  fromMass: number;
  toMass: number;
  planets: Map<number, Drift>;
  ships: Map<number, Drift>;
}

const SWALLOW_MARGIN = 14;

/**
 * "Ereignishorizont" — gravity royale. Everyone locks in an aim, then all shots fly at once.
 * After every volley the central black hole grows, eats planets and drags ships inwards.
 * Kills pay base × trick-shot combo and get a slow-motion killcam.
 */
export class HorizonMatch extends Match {
  readonly mode = 'horizon';
  volleyNo = 0;
  lastClip: KillcamClip | null = null;
  killcam: KillcamState | null = null;

  private clock_ = HORIZON.SHOT_CLOCK;
  private queue: number[] = [];
  private snapshot: World | null = null;
  private aims: VolleyAim[] = [];
  private volleyKills: { record: KillRecord; shotIndex: number; step: number }[] = [];
  private collapse: CollapseState | null = null;

  get rules(): ShotRules {
    return { bounce: this.settings.bounce, timeLimit: this.settings.shotTime };
  }

  protected get survivorBonus(): number {
    return SCORING.LAST_IN_ORBIT;
  }

  protected get volleyNumber(): number {
    return this.volleyNo;
  }

  get shotClock(): number | null {
    return this.phase === 'aiming' && this.isHumanTurn ? Math.max(0, this.clock_) : null;
  }

  get nextHoleRadius(): number | null {
    const hole = this.world.hole;
    if (!hole || this.phase === 'roundOver' || this.phase === 'gameOver') return null;
    if (this.collapse) return this.collapse.toRadius;
    return hole.radius + HORIZON.GROWTH + HORIZON.GROWTH_ACCEL * this.volleyNo;
  }

  get canReplay(): boolean {
    return !!this.lastClip && (this.phase === 'roundOver' || (this.phase === 'killcam' && !this.killcam?.recording));
  }

  scene(): Scene {
    const k = this.killcam;
    if (k) return { world: k.replay.world, trails: [], volley: k.replay, camera: k.camera };
    return super.scene();
  }

  devourProgress(seed: number): number {
    return this.collapse?.planets.get(seed)?.lost ? this.collapseT : 0;
  }

  swallowProgress(ship: number): number {
    return this.collapse?.ships.get(ship)?.lost ? this.collapseT : 0;
  }

  private get collapseT(): number {
    return Math.min(1, this.phaseTime / HORIZON.COLLAPSE_TIME);
  }

  protected beginRound(): void {
    this.volleyNo = 0;
    this.lastClip = null;
    this.killcam = null;
    this.collapse = null;
    this.startPlanning();
  }

  // ————————————————————————————— Planning —————————————————————————————

  private startPlanning(): void {
    this.volleyNo++;
    // Keep only the previous volley's trails — they're what you correct against.
    this.trails = this.trails.filter((t) => t.volley >= this.volleyNo - 1);
    const alive = this.alive;
    for (const p of alive) p.locked = false;
    // Rotate who aims first so nobody always waits last.
    const start = (this.round + this.volleyNo) % alive.length;
    const order = [...alive.slice(start), ...alive.slice(0, start)];
    this.queue = order.filter((p) => !p.cpu).map((p) => p.id);
    this.cpuJobs.clear();
    this.setPhase('aiming');
    this.nextHuman();
  }

  private nextHuman(): void {
    this.current = this.queue.shift() ?? -1;
    this.clock_ = HORIZON.SHOT_CLOCK;
    if (this.current >= 0) this.emit({ type: 'turn', player: this.current });
  }

  commit(): void {
    if (!this.isHumanTurn) return;
    this.players[this.current].locked = true;
    this.emit({ type: 'lock', player: this.current });
    this.nextHuman();
  }

  protected updatePhase(dt: number): void {
    if (this.phase === 'aiming') this.updatePlanning(dt);
    else if (this.phase === 'killcam') this.updateKillcam(dt);
    else if (this.phase === 'collapse') this.updateCollapse();
  }

  private updatePlanning(dt: number): void {
    const cpus = this.alive.filter((p) => p.cpu && !p.locked);
    if (cpus.length) {
      // All CPUs think in parallel while the humans aim. Shots never leave the walled arena,
      // so a shorter look-ahead keeps the search affordable.
      this.runCpu(cpus.map((p) => p.id), 8, 0.6, 7);
      for (const p of cpus) {
        const job = this.cpuJob(p.id);
        if (!job?.target || this.phaseTime < 0.5) continue;
        if (this.swingTowards(p, job.target, dt, 2)) {
          job.settle += dt;
          if (job.settle > 0.2) {
            p.locked = true;
            this.emit({ type: 'lock', player: p.id });
          }
        }
      }
    }
    if (this.current >= 0) {
      this.clock_ -= dt;
      if (this.clock_ <= 0) this.commit();
    }
    if (this.alive.every((p) => p.locked) && this.phaseTime > 0.6) this.launchVolley();
  }

  private launchVolley(): void {
    this.snapshot = cloneWorld(this.world);
    this.aims = this.alive.map((p) => ({ player: p.id, angle: p.angle, power: p.power }));
    for (const p of this.alive) p.shots++;
    this.volleyKills = [];
    this.notice = { text: t('notice.volley'), color: COLORS.bone, at: this.clock };
    this.emit({ type: 'volley' });
    this.launch(this.aims, true);
  }

  protected onKill(record: KillRecord, shotIndex: number, step: number): void {
    this.volleyKills.push({ record, shotIndex, step });
  }

  protected afterVolley(): void {
    // Replay the volley's best kill (self-hits only if that's all there was).
    const best = [...this.volleyKills].sort((a, b) => Number(own(a.record)) - Number(own(b.record)) || b.record.points - a.record.points)[0];
    if (best && this.snapshot) {
      this.lastClip = {
        snapshot: this.snapshot,
        aims: this.aims,
        focus: best.shotIndex,
        victim: best.record.victim,
        killStep: best.step,
        record: best.record,
      };
      this.startKillcam(this.lastClip, null, false);
    } else {
      this.startCollapse();
    }
  }

  protected killPoints(vs: VolleyShot): { points: number; combo: StyleKind[]; multiplier: number } {
    const kinds = (vs.shot.style ?? []).map((e) => e.kind);
    const { points, combo } = scoreHorizonKill(vs.shot.power, kinds, this.settings.fixedPower);
    return { points, combo: kinds, multiplier: combo };
  }

  // ————————————————————————————— Killcam —————————————————————————————

  /** Replay the last kill (e.g. to record a clip). Returns false when there is nothing to replay right now. */
  replayLastKill(recording: boolean): boolean {
    if (!this.lastClip || !this.canReplay) return false;
    const returnTo = this.phase === 'killcam' ? this.killcam!.returnTo : this.phase;
    this.startKillcam(this.lastClip, returnTo, recording);
    return true;
  }

  get killcamInfo(): { clip: KillcamClip; recording: boolean; slow: boolean } | null {
    const k = this.killcam;
    if (!k) return null;
    return { clip: k.clip, recording: k.recording, slow: this.killcamRate(k) < 0.5 };
  }

  private startKillcam(clip: KillcamClip, returnTo: Phase | null, recording: boolean): void {
    const replay = new Volley(cloneWorld(clip.snapshot), clip.aims, this.rules, true);
    const start = replay.shots[clip.focus].shot;
    this.killcam = { clip, replay, simClock: 0, hold: 0, camera: { x: start.x, y: start.y, zoom: 1.2 }, returnTo, recording };
    this.setPhase('killcam');
    this.emit({ type: 'killcam', active: true, recording });
  }

  private killcamRate(k: KillcamState): number {
    const toKill = k.clip.killStep - k.replay.steps;
    if (toKill <= 0) return 0.3;
    // Slow motion for the last moments before impact.
    return toKill < 0.7 / PHYSICS.DT ? 0.2 : 0.85;
  }

  private updateKillcam(dt: number): void {
    const k = this.killcam!;
    k.simClock += dt * this.killcamRate(k);
    while (k.simClock >= PHYSICS.DT && !k.replay.done) {
      k.simClock -= PHYSICS.DT;
      for (const e of k.replay.step()) this.onVolleyEvent(k.replay, e, false);
    }
    const afterKill = k.replay.steps >= k.clip.killStep;
    if (afterKill || k.replay.done) k.hold += dt;

    // Follow the killing shot, then settle on the wreck.
    const focus = k.replay.shots[k.clip.focus].shot;
    const victim = k.replay.world.ships[k.clip.victim];
    const tx = afterKill ? victim.x : focus.x;
    const ty = afterKill ? victim.y : focus.y;
    const tz = afterKill ? 2.3 : 1.7;
    const f = 1 - Math.exp(-dt * 5);
    const cam = k.camera;
    cam.zoom += (tz - cam.zoom) * f;
    cam.x += (tx - cam.x) * f;
    cam.y += (ty - cam.y) * f;
    const halfW = k.replay.world.width / (2 * cam.zoom);
    const halfH = k.replay.world.height / (2 * cam.zoom);
    cam.x = Math.min(k.replay.world.width - halfW, Math.max(halfW, cam.x));
    cam.y = Math.min(k.replay.world.height - halfH, Math.max(halfH, cam.y));

    if (k.hold > 1.4) this.endKillcam();
  }

  private endKillcam(): void {
    const k = this.killcam!;
    this.killcam = null;
    this.emit({ type: 'killcam', active: false, recording: k.recording });
    if (k.returnTo) this.setPhase(k.returnTo);
    else this.startCollapse();
  }

  advance(): void {
    if (this.phase === 'killcam') {
      if (!this.killcam!.recording && this.phaseTime > 0.3) this.endKillcam();
      return;
    }
    super.advance();
  }

  // ————————————————————————————— Collapse —————————————————————————————

  /** The black hole grows, eats what comes too close and pulls everything else inwards. */
  private startCollapse(): void {
    const hole = this.world.hole!;
    const toRadius = hole.radius + HORIZON.GROWTH + HORIZON.GROWTH_ACCEL * this.volleyNo;
    let toMass = hole.mass + HORIZON.MASS_PER_VOLLEY;
    const pull = (x: number, y: number, factor: number, margin: number): Drift => {
      const d = Math.hypot(x - hole.x, y - hole.y);
      const drift = Math.min(HORIZON.MAX_DRIFT, Math.max(HORIZON.MIN_DRIFT, (HORIZON.DRIFT * hole.mass) / (d * d))) * factor;
      const lost = d - drift < toRadius + margin;
      const k = lost ? 1 : drift / d;
      return { fromX: x, fromY: y, toX: x + (hole.x - x) * k, toY: y + (hole.y - y) * k, lost };
    };

    const planets = new Map<number, Drift>();
    for (const p of this.world.planets) {
      const drift = pull(p.x, p.y, 0.6, p.radius * 0.6);
      if (drift.lost) {
        toMass += p.mass * HORIZON.FEED;
        this.emit({ type: 'devour', x: p.x, y: p.y, toX: hole.x, toY: hole.y, color: p.tint });
      }
      planets.set(p.seed, drift);
    }
    const ships = new Map<number, Drift>();
    for (const p of this.alive) {
      const s = this.world.ships[p.id];
      ships.set(p.id, pull(s.x, s.y, 1, SWALLOW_MARGIN));
    }
    this.collapse = { fromRadius: hole.radius, toRadius, fromMass: hole.mass, toMass, planets, ships };
    this.setPhase('collapse');
    this.emit({ type: 'collapse', x: hole.x, y: hole.y });
  }

  private updateCollapse(): void {
    const c = this.collapse!;
    const t = this.collapseT;
    const e = t * t * (3 - 2 * t);
    const hole = this.world.hole!;
    hole.radius = c.fromRadius + (c.toRadius - c.fromRadius) * e;
    hole.mass = c.fromMass + (c.toMass - c.fromMass) * e;
    for (const p of this.world.planets) move(p, c.planets.get(p.seed)!, e, t);
    for (const [id, d] of c.ships) move(this.world.ships[id], d, e, t);
    if (t >= 1) this.finishCollapse();
  }

  private finishCollapse(): void {
    const c = this.collapse!;
    const hole = this.world.hole!;
    this.collapse = null;
    this.world.planets = this.world.planets.filter((p) => !c.planets.get(p.seed)?.lost);
    this.world.version++;

    for (const [id, d] of c.ships) {
      if (!d.lost) continue;
      this.players[id].alive = false;
      this.world.ships[id].alive = false;
      this.emit({ type: 'devour', x: hole.x, y: hole.y, toX: hole.x, toY: hole.y, color: this.players[id].color });
      this.recordKill({ killer: null, victim: id, points: 0, self: false, friendly: false, combo: [], multiplier: 1, shots: 0, power: 0, at: this.clock });
    }
    for (const p of this.alive) p.score += SCORING.VOLLEY_SURVIVED;

    if (this.decided) this.endRound();
    else this.startPlanning();
  }

  protected roundTitle(survivor: number | null): RoundTitle {
    if (survivor !== null) return 'lastInOrbit';
    return this.lastKill?.killer === null ? 'swallowed' : 'noneLeft';
  }
}

/** A kill against your own side — never the first choice for the killcam. */
const own = (r: KillRecord) => r.self || r.friendly;

/** Ease towards the drift target; things falling into the hole accelerate (quadratic). */
function move(o: { x: number; y: number }, d: Drift, e: number, t: number): void {
  const k = d.lost ? t * t : e;
  o.x = d.fromX + (d.toX - d.fromX) * k;
  o.y = d.fromY + (d.toY - d.fromY) * k;
}
