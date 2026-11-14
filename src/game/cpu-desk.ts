import { planShot, type Aim, type CpuDecision } from '../sim/ai';
import { createRng, type Rng } from '../sim/rng';
import { normalizeAngle, type ShotGate, type ShotRules, type World } from '../sim/physics';
import { CPU_IGNORES, POWER_UP, type Pickup } from '../sim/powerups';
import { startPower, type Settings } from '../data/settings';
import { cpuPlacementAim } from './cpu-placement';
import type { CpuDecisionReport, CpuJob, MatchOptions, Mode, PlayerState } from './match-types';

/** What the desk reads of the match whose CPUs it thinks for. */
export interface CpuDeskDeps {
  world(): World;
  players(): PlayerState[];
  rules(): ShotRules;
  settings(): Settings;
  friendsOf(id: number): number[];
  /** The ships a CPU's shot passes through for now (the neighbour grace period). */
  sparedFor(id: number): number[];
  pickups(): Pickup[];
  powerUps(): boolean;
  /** A CPU's teleport: false when it cannot jump now. */
  teleport(id: number): boolean;
  options(): Pick<MatchOptions, 'deterministicCpu' | 'onCpuDecision'>;
  matchSeed(): number;
  mode(): Mode;
  round(): number;
}

/** Swing a CPU's ship towards its chosen aim like a player would. True once it's there. */
export function swingTowards(p: PlayerState, target: Aim, dt: number, speed = 1): boolean {
  const dA = ((target.angle - p.angle + 540) % 360) - 180;
  const dP = target.power - p.power;
  const stepA = 140 * speed * dt;
  const stepP = 70 * speed * dt;
  const doneA = Math.abs(dA) <= stepA;
  const doneP = Math.abs(dP) <= stepP;
  p.angle = normalizeAngle(doneA ? target.angle : p.angle + Math.sign(dA) * stepA);
  p.power = doneP ? target.power : p.power + Math.sign(dP) * stepP;
  return doneA && doneP;
}

/**
 * The thinking of the CPUs of a match: a planner per CPU on turn, run a little each frame, the grudges they hold, and the one rescue
 * a CPU that found no hitting shot tries. The modes decide when a CPU thinks and what it does with the aim it settles on.
 */
export class CpuDesk {
  private readonly jobs = new Map<number, CpuJob>();
  private readonly rngs = new Map<number, Rng>();
  /** Who hit each player last — CPUs with a grudge aim back at them. */
  private readonly lastHitBy = new Map<number, number>();

  constructor(private readonly deps: CpuDeskDeps) {}

  /** A new match: the planners start from their seeds again, and nobody holds a grudge. */
  newMatch(): void {
    this.rngs.clear();
    this.lastHitBy.clear();
  }

  /** A grudge lasts one round — whoever survived it starts the next one clean. */
  startRound(): void {
    this.lastHitBy.clear();
    this.jobs.clear();
  }

  /** A CPU hit by an enemy remembers it — level profiles with a grudge aim back. */
  noteHit(victim: number, killer: number): void {
    this.lastHitBy.set(victim, killer);
  }

  /** Whatever the CPUs were working on is no longer what the game asks of them. */
  clear(): void {
    this.jobs.clear();
  }

  job(id: number): CpuJob | undefined {
    return this.jobs.get(id);
  }

  private rngFor(id: number): Rng {
    let rng = this.rngs.get(id);
    if (!rng) {
      rng = createRng(this.deps.matchSeed() ^ Math.imul(this.deps.players()[id].seat + 1, 0x9e3779b9));
      this.rngs.set(id, rng);
    }
    return rng;
  }

  /**
   * A CPU that planned and found no hitting shot tries its way out once and plans again: a teleport jumps to a
   * new spot, a plasma shot is armed. Returns true when it did, so the caller leaves this tick to the new plan.
   */
  rescueIfBlind(p: PlayerState, job: CpuJob | undefined): boolean {
    if ((p.powerUp !== 'teleport' && p.powerUp !== 'plasma') || !job?.target || !job.blind || job.rescueTried) return false;
    job.rescueTried = true;
    if (p.powerUp === 'plasma') {
      // Armed already: the plan that came up blind was made with it, so there is nothing left to try.
      if (p.armed) return false;
      p.armed = true;
      this.jobs.clear();
      return true;
    }
    return this.deps.teleport(p.id);
  }

  /** Where a CPU lays the placement it holds, as an aim (see `cpuPlacementAim`). */
  placementAim(p: PlayerState): Aim | null {
    return cpuPlacementAim(this.deps.world(), this.deps.players(), p, this.deps.friendsOf(p.id));
  }

  /** Think for the given CPU players, sharing a per-frame time budget round-robin. */
  run(ids: number[], budgetMs: number, effort: number, lookahead?: number): void {
    const { deps } = this;
    const options = deps.options();
    const world = deps.world();
    const players = deps.players();
    const logDecisions = (typeof process !== 'undefined' && process.env.AI_DECISION_LOGS === '1')
      || import.meta.env?.VITE_AI_DECISION_LOGS === '1';
    for (const id of ids) {
      if (this.jobs.has(id)) continue;
      const p = players[id];
      const settings = deps.settings();
      const friends = [...deps.friendsOf(id), ...deps.sparedFor(id)];
      // Einstein and Hawking hold armor piercing for a cannon: it may wreck one an ordinary shot only meets a missile from.
      if (p.powerUp === 'piercing' && !p.armed && (p.cpu === 'hard' || p.cpu === 'hawking') && world.defenses.some((d) => !d.wrecked && !d.protects.includes(id))) p.armed = true;
      const pierce = !!p.armed && p.powerUp === 'piercing';
      const plasma = !!p.armed && p.powerUp === 'plasma';
      // The pickups a CPU would actually keep (a preview is of no use to it): the planner steers its
      // search through them, so a power-up-hungry level like Einstein collects more.
      const pickups: ShotGate[] = deps.powerUps()
        ? deps.pickups()
            .filter((pickup) => !CPU_IGNORES[pickup.kind])
            .map((pickup) => ({ x: pickup.x, y: pickup.y, r: POWER_UP.PICKUP_RADIUS }))
        : [];
      const planner = planShot(world, id, {
        rules: deps.rules(),
        level: p.cpu ?? 'medium',
        attempt: p.shots,
        fixedPower: settings.fixedPower ? startPower(settings) : null,
        maxPower: settings.maxPower,
        rng: this.rngFor(id),
        effort,
        lookahead,
        friends,
        pierce,
        plasma,
        pickups,
        grudgeTarget: this.lastHitBy.get(id) ?? null,
        // A CPU holding a teleport or a plasma shot also wants to know whether it found a hitting shot at all.
        ...(logDecisions || options.onCpuDecision || (deps.powerUps() && (p.powerUp === 'teleport' || p.powerUp === 'plasma'))
          ? {
              onDecision: (decision) => {
                const job = this.jobs.get(id);
                if (job) job.blind = decision.hitCandidates === 0;
                if (logDecisions || options.onCpuDecision) this.report(id, decision, logDecisions);
              },
            }
          : {}),
      });
      this.jobs.set(id, { planner, target: null, settle: 0 });
    }
    const deadline = options.deterministicCpu ? 0 : performance.now() + budgetMs;
    let busy = true;
    while (busy && (options.deterministicCpu || performance.now() < deadline)) {
      busy = false;
      for (const id of ids) {
        const job = this.jobs.get(id);
        if (!job?.planner) continue;
        busy = true;
        const r = job.planner.next();
        if (r.done) {
          job.target = r.value;
          job.planner = null;
        }
      }
    }
  }

  private report(player: number, decision: CpuDecision, logsEnabled: boolean): void {
    const report: CpuDecisionReport = {
      mode: this.deps.mode(),
      round: this.deps.round(),
      player,
      shot: this.deps.players()[player].shots + 1,
      ...decision,
    };
    this.deps.options().onCpuDecision?.(report);
    if (logsEnabled) console.info('[AI] decision', report);
  }
}
