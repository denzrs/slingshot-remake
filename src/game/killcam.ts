import { PHYSICS } from '../sim/config';
import { cloneWorld, type ShotRules, type World } from '../sim/physics';
import { shotSource, Volley, type VolleyAim, type VolleyEvent, type VolleyScript, type VolleyShot, type VolleySnapshot } from '../sim/volley';
import type { Camera, KillRecord, Phase, Scene } from './match';

/** Everything needed to replay one kill exactly — the physics is deterministic. */
interface KillcamClip {
  snapshot: World;
  aims: VolleyAim[];
  /** What was done to the flight on the way (splits, shields), so the replay flies the same flight. */
  script?: VolleyScript[];
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
  /** Online: the players who voted to skip. */
  skipVotes: number[];
}

/** Shared wire fields; kept at the top level so the patch encoder can send clips once and trails incrementally. */
export interface KillcamSnapshot {
  snapshot: World | null;
  aims: VolleyAim[];
  volleyKills: { record: KillRecord; shotIndex: number; step: number }[];
  killcamClip: KillcamClip | null;
  killcam: null | Omit<KillcamState, 'clip' | 'replay'> & { replay: VolleySnapshot; world?: Pick<World, 'ships' | 'defenses' | 'version'> };
  lastClip: KillcamClip | null;
}

/** Captures a flight and replays its best kill without changing the live world or scoring. */
export class Killcam {
  lastClip: KillcamClip | null = null;
  active: KillcamState | null = null;
  private world: World | null = null;
  private aims: VolleyAim[] = [];
  private kills: KillcamSnapshot['volleyKills'] = [];

  reset(): void {
    this.lastClip = null;
    this.active = null;
    this.world = null;
    this.aims = [];
    this.kills = [];
  }

  capture(world: World, aims: VolleyAim[]): void {
    this.world = cloneWorld(world);
    this.aims = aims.map((aim) => ({ ...aim, ...(aim.spare ? { spare: [...aim.spare] } : {}) }));
    this.kills = [];
  }

  record(record: KillRecord, shotIndex: number, step: number): void {
    this.kills.push({ record, shotIndex, step });
  }

  get hasKills(): boolean {
    return this.kills.length > 0;
  }

  finish(script: VolleyScript[], lastOnly = false): KillcamClip | null {
    const own = (r: KillRecord) => r.self || r.friendly;
    const best = lastOnly ? this.kills.at(-1) : [...this.kills].sort((a, b) => Number(own(a.record)) - Number(own(b.record)) || b.record.points - a.record.points)[0];
    if (!best || !this.world) return null;
    this.lastClip = {
      snapshot: this.world, aims: this.aims, script,
      focus: best.shotIndex, victim: best.record.victim, killStep: best.step, record: best.record,
    };
    return this.lastClip;
  }

  info(needed: number) {
    const k = this.active;
    return k ? { clip: k.clip, recording: k.recording, slow: this.killcamRate(k) < 0.5, votes: k.skipVotes.length, needed } : null;
  }

  scene(): Scene | null {
    const k = this.active;
    return k ? { world: k.replay.world, trails: [], volley: k.replay, camera: k.camera } : null;
  }

  snapshot(): KillcamSnapshot {
    const k = this.active;
    return {
      snapshot: this.world, aims: this.aims, volleyKills: this.kills,
      killcamClip: k?.clip ?? null,
      killcam: k ? {
        world: { ships: k.replay.world.ships, defenses: k.replay.world.defenses, version: k.replay.world.version },
        replay: k.replay.snapshot(), simClock: k.simClock, hold: k.hold,
        camera: k.camera, returnTo: k.returnTo, recording: k.recording, skipVotes: [...k.skipVotes],
      } : null,
      lastClip: this.lastClip,
    };
  }

  restore(s: Partial<KillcamSnapshot>, rules: ShotRules): void {
    this.world = s.snapshot ?? null;
    this.aims = s.aims ?? [];
    this.kills = [...(s.volleyKills ?? [])];
    this.lastClip = s.lastClip ?? null;
    this.active = null;
    if (s.killcam && s.killcamClip) {
      const clip = s.killcamClip;
      // The current aims also include forks and stray missiles already created during playback.
      const world = cloneWorld({ ...clip.snapshot, ...s.killcam.world });
      const replay = new Volley(world, s.killcam.replay.aims, rules, true, clip.script);
      replay.restore(s.killcam.replay);
      this.active = { ...s.killcam, clip, replay, camera: { ...s.killcam.camera }, skipVotes: [...s.killcam.skipVotes] };
    }
  }

  start(clip: KillcamClip, returnTo: Phase | null, recording: boolean, rules: ShotRules): void {
    const replay = new Volley(cloneWorld(clip.snapshot), clip.aims, rules, true, clip.script);
    const start = this.focusShot(replay, clip).shot;
    this.active = { clip, replay, simClock: 0, hold: 0, camera: { x: start.x, y: start.y, zoom: 1.2 }, returnTo, recording, skipVotes: [] };
  }

  /** The shot the killcam follows: the killing one, or — until a split has made it — the shot it will branch off from. */
  private focusShot(replay: Volley, clip: KillcamClip): VolleyShot {
    // A stray missile is made mid-flight too; until then the camera stays on the last shot there is.
    return replay.shots[clip.focus] ?? replay.shots[shotSource(clip.aims.length, clip.script ?? [], clip.focus)] ?? replay.shots[replay.shots.length - 1];
  }

  private killcamRate(k: KillcamState): number {
    const toKill = k.clip.killStep - k.replay.steps;
    if (toKill <= 0) return 0.3;
    // Slow motion for the last moments before impact.
    return toKill < 0.7 / PHYSICS.DT ? 0.2 : 0.85;
  }

  update(dt: number, onEvent: (volley: Volley, event: VolleyEvent) => void): boolean {
    const k = this.active!;
    k.simClock += dt * this.killcamRate(k);
    while (k.simClock >= PHYSICS.DT && !k.replay.done) {
      k.simClock -= PHYSICS.DT;
      for (const e of k.replay.step()) onEvent(k.replay, e);
    }
    const afterKill = k.replay.steps >= k.clip.killStep;
    if (afterKill || k.replay.done) k.hold += dt;

    // Follow the killing shot, then settle on the wreck.
    const focus = this.focusShot(k.replay, k.clip).shot;
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

    return k.hold > 1.4;
  }
}
