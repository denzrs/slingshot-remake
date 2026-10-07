import { describe, expect, it } from 'vitest';
import { ClassicMatch } from '../src/game/classic';
import { HorizonMatch } from '../src/game/horizon';
import type { CompletedShotReport, ExperimentalReport, MatchOptions } from '../src/game/match';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';
import { ExperimentalWorkerClient, type ExperimentalWorkerPort } from '../src/experimental-worker-client';
import { createExperimentalWorkerProcessor } from '../src/experimental-worker';
import type { ExperimentalWorkerRequest, ExperimentalWorkerResponse } from '../src/experimental-worker-protocol';

const seats: Seat[] = ['experimental', 'human', 'off', 'off', 'off', 'off'];
const settings = { ...DEFAULT_SETTINGS, seats, rounds: 3, maxPlanets: 0, shotTime: 0.15, bounce: false, fixedPower: false };

class LearningClassic extends ClassicMatch {
  think(ids = [0]): void {
    this.runCpu(ids, 1, 0.05);
  }
  observation() {
    return this.observedWorld(0);
  }
  fireOwn(angle = 90, power = 20): void {
    this.players[0].shots++;
    this.launch([{ player: 0, angle, power }], false);
  }
  firePlayers(): void {
    const aims = this.players.map((player) => {
      player.shots++;
      return { player: player.id, angle: 90, power: 20 };
    });
    this.launch(aims, false);
  }
}

class LearningHorizon extends HorizonMatch {
  think(ids = [0]): void {
    this.runCpu(ids, 1, 0.05);
  }
  observation() {
    return this.observedWorld(0);
  }
  fireOwn(angle = 90, power = 20): void {
    this.players[0].shots++;
    this.launch([{ player: 0, angle, power }], false);
  }
  firePlayers(): void {
    const aims = this.players.map((player) => {
      player.shots++;
      return { player: player.id, angle: 90, power: 20 };
    });
    this.launch(aims, false);
  }
}

class MatchWorkerPort implements ExperimentalWorkerPort {
  onmessage: ExperimentalWorkerPort['onmessage'] = null;
  onerror: ExperimentalWorkerPort['onerror'] = null;
  onmessageerror: ExperimentalWorkerPort['onmessageerror'] = null;
  requests: ExperimentalWorkerRequest[] = [];
  responses: ExperimentalWorkerResponse[] = [];
  terminated = false;
  private process = createExperimentalWorkerProcessor();
  postMessage(request: ExperimentalWorkerRequest): void { this.requests.push(structuredClone(request)); }
  processAll(): void {
    for (const request of this.requests.splice(0)) this.responses.push(structuredClone(this.process(request)));
  }
  deliverNext(): void {
    const response = this.responses.shift();
    if (!response) throw new Error('No worker response');
    this.onmessage?.({ data: response });
  }
  flush(): void {
    this.processAll();
    while (this.responses.length) this.deliverNext();
  }
  terminate(): void { this.terminated = true; }
}

class WorkerClassic extends LearningClassic {
  finishes = 0;
  protected afterVolley(): void { this.finishes++; super.afterVolley(); }
  planNow(ids = [0]): void {
    this.runCpu(ids, 0, 0.05);
    for (const id of ids) {
      const job = this.cpuJob(id);
      if (job?.planner) while (!job.planner.next().done) { /* Drain the real planner without a clock budget. */ }
    }
  }
}

class WorkerHorizon extends LearningHorizon {
  finishes = 0;
  protected afterVolley(): void { this.finishes++; super.afterVolley(); }
  planNow(ids = [0]): void {
    this.runCpu(ids, 0, 0.05);
    for (const id of ids) {
      const job = this.cpuJob(id);
      if (job?.planner) while (!job.planner.next().done) { /* Drain the real planner without a clock budget. */ }
    }
  }
}

async function deliverWorker(worker: MatchWorkerPort): Promise<void> {
  worker.flush();
  // Settle the bounded client, per-shot, and volley Promise chains without timers.
  for (let step = 0; step < 12; step++) await Promise.resolve();
}

function finishWorkerPhysics(match: WorkerClassic | WorkerHorizon): void {
  for (let frame = 0; frame < 300 && !match.volley?.done; frame++) match.update(1 / 30);
  expect(match.volley?.done).toBe(true);
  expect(match.phase).toBe('flying');
}

function finishFlight(match: ClassicMatch | HorizonMatch): void {
  for (let frame = 0; frame < 300 && (match.phase === 'flying' || match.phase === 'collapse' || match.phase === 'killcam'); frame++) {
    match.update(1 / 30);
    if (match.phase === 'killcam') match.advance();
  }
  expect(match.phase).toBe('aiming');
}

describe('experimental match learning', () => {
  for (const Game of [LearningClassic, LearningHorizon]) {
    it(`${Game.name} runs three fixed experimental presets alongside every original CPU independently of custom options`, () => {
      const mixedSeats: Seat[] = ['experimental-easy', 'experimental-medium', 'experimental-hard', 'easy', 'medium', 'hard'];
      const configs = [
        { learningRate: 0.45, startingKnowledge: 0.5 },
        { learningRate: 0.54, startingKnowledge: 0.72 },
        { learningRate: 0.72, startingKnowledge: 0.9 },
      ];
      const decisions: ExperimentalReport[] = [];
      const completed: CompletedShotReport[] = [];
      const match = new Game({ ...settings, seats: mixedSeats }, {
        seed: 7129,
        deterministicCpu: true,
        experimentalLearningRate: 0.12,
        experimentalStartingKnowledge: 0.23,
        onExperimentalDecision: (report) => decisions.push(report),
        onShotComplete: (report) => completed.push(report),
      });
      match.newMatch();
      expect(match.players.map((player) => player.cpu)).toEqual(mixedSeats);
      // Keep each real short flight away from other ships and the central hole.
      for (const player of match.players) {
        Object.assign(match.world.ships[player.id], { x: 100 + player.id * 200, y: 100 });
      }
      match.think([0, 1, 2, 3, 4, 5]);
      expect(decisions).toHaveLength(3);
      for (const [player, config] of configs.entries()) {
        expect(decisions.find((report) => report.player === player)).toMatchObject({
          ...config, observedShots: 0, learnedShots: 0,
        });
      }
      match.firePlayers();
      finishFlight(match);
      for (const player of match.players) {
        const report = completed.find((report) => report.player === player.id)!;
        expect(report).toMatchObject({ player: player.id, shot: 1, outcome: 'timeout' });
        if (player.id < configs.length) {
          const config = configs[player.id];
          expect(report.experimentalObservation).toMatchObject({
            ...config, observedShots: 1, learnedShots: config.learningRate,
          });
          expect(report.experimentalObservation!.predictionSamples).toBeGreaterThan(0);
          expect(report.experimentalObservation!.retainedShots).toBeGreaterThan(0);
        } else {
          expect(report.experimentalObservation).toBeNull();
        }
      }
      expect(completed).toHaveLength(6);
      decisions.length = 0;
      match.think([0, 1, 2, 3, 4, 5]);
      expect(decisions).toHaveLength(3);
      for (const [player, config] of configs.entries()) {
        expect(decisions.find((report) => report.player === player)).toMatchObject({
          ...config, observedShots: 1, learnedShots: config.learningRate,
        });
      }
      // Both a new field and a rematch must restore each seat's own fixed prior.
      for (const reset of ['round', 'match'] as const) {
        if (reset === 'round') match.startRound();
        else match.newMatch();
        decisions.length = 0;
        match.think([0, 1, 2, 3, 4, 5]);
        expect(decisions).toHaveLength(3);
        for (const [player, config] of configs.entries()) {
          expect(decisions.find((report) => report.player === player)).toMatchObject({
            ...config, observedShots: 0, learnedShots: 0,
          });
        }
      }
    });

    for (const [configuredRate, effectiveRate] of [
      [undefined, 1], [-1, 0], [2, 1], [NaN, 0], [Infinity, 0], [-Infinity, 0],
    ] as const) {
      it(`${Game.name} applies effective rate ${effectiveRate} for option ${String(configuredRate)}`, () => {
        const decisions: ExperimentalReport[] = [];
        const completed: CompletedShotReport[] = [];
        const match = new Game({ ...settings }, {
          seed: 7129,
          deterministicCpu: true,
          ...(configuredRate === undefined ? {} : { experimentalLearningRate: configuredRate }),
          onExperimentalDecision: (report) => decisions.push(report),
          onShotComplete: (report) => completed.push(report),
        });
        match.newMatch();
        match.think();
        expect(decisions.at(-1)).toMatchObject({ learningRate: effectiveRate, startingKnowledge: 1, observedShots: 0, learnedShots: 0 });
        match.fireOwn();
        finishFlight(match);
        expect(completed).toHaveLength(1);
        expect(completed[0].experimentalObservation).toMatchObject({
          learningRate: effectiveRate, startingKnowledge: 1, observedShots: 1, learnedShots: effectiveRate,
        });
        if (effectiveRate === 0) expect(completed[0].experimentalObservation!.retainedShots).toBe(0);
        match.think();
        expect(decisions.at(-1)).toMatchObject({ learningRate: effectiveRate, startingKnowledge: 1, observedShots: 1, learnedShots: effectiveRate });
      });
    }

    for (const [configuredKnowledge, effectiveKnowledge] of [
      [undefined, 1], [0, 0], [0.35, 0.35], [1, 1], [-1, 0], [2, 1], [NaN, 0], [Infinity, 0], [-Infinity, 0],
    ] as const) {
      it(`${Game.name} preserves starting knowledge ${effectiveKnowledge} for option ${String(configuredKnowledge)} independently of learned evidence`, () => {
        const decisions: ExperimentalReport[] = [];
        const completed: CompletedShotReport[] = [];
        const match = new Game({ ...settings }, {
          seed: 7129,
          deterministicCpu: true,
          experimentalLearningRate: 0.35,
          ...(configuredKnowledge === undefined ? {} : { experimentalStartingKnowledge: configuredKnowledge }),
          onExperimentalDecision: (report) => decisions.push(report),
          onShotComplete: (report) => completed.push(report),
        });
        match.newMatch();
        match.think();
        expect(decisions.at(-1)).toMatchObject({ startingKnowledge: effectiveKnowledge, learningRate: 0.35, observedShots: 0, learnedShots: 0 });
        expect(decisions.at(-1)!.decision.startingKnowledge).toBe(effectiveKnowledge);
        match.fireOwn();
        finishFlight(match);
        expect(completed[0].experimentalObservation).toMatchObject({
          startingKnowledge: effectiveKnowledge, learningRate: 0.35, observedShots: 1, learnedShots: 0.35,
        });
        match.trails = [];
        match.think();
        expect(decisions.at(-1)).toMatchObject({ startingKnowledge: effectiveKnowledge, observedShots: 1, learnedShots: 0.35 });
        match.startRound();
        match.think();
        expect(decisions.at(-1)).toMatchObject({ round: 2, startingKnowledge: effectiveKnowledge, observedShots: 0, learnedShots: 0 });
        match.newMatch();
        match.think();
        expect(decisions.at(-1)).toMatchObject({ round: 1, startingKnowledge: effectiveKnowledge, observedShots: 0, learnedShots: 0 });
      });
    }

    it(`${Game.name} changes the opening public gravity belief without consuming evidence or changing the seeded world`, () => {
      const openingReports: ExperimentalReport[] = [];
      const matches = [0, 1].map((startingKnowledge) => new Game({ ...settings, maxPlanets: 1 }, {
        seed: 7139,
        deterministicCpu: true,
        experimentalStartingKnowledge: startingKnowledge,
        experimentalLearningRate: 0,
        onExperimentalDecision: (report) => openingReports.push(report),
      }));
      for (const match of matches) {
        match.newMatch();
        match.think();
      }
      expect(matches[0].world.planets).toHaveLength(1);
      expect(matches[0].world).toEqual(matches[1].world);
      expect(openingReports).toHaveLength(2);
      expect(openingReports[0]).toMatchObject({ startingKnowledge: 0, learningRate: 0, observedShots: 0, learnedShots: 0, retainedShots: 0 });
      expect(openingReports[1]).toMatchObject({ startingKnowledge: 1, learningRate: 0, observedShots: 0, learnedShots: 0, retainedShots: 0 });
      expect(openingReports[1].relativeGravityMapRms).toBeLessThan(openingReports[0].relativeGravityMapRms);
    });

    for (const rate of [0, 0.35, 1]) {
      it(`${Game.name} retains own observations independently of rendered trails at rate ${rate}`, () => {
        const decisions: ExperimentalReport[] = [];
        const completed: CompletedShotReport[] = [];
        const match = new Game({ ...settings }, {
          seed: 7129,
          deterministicCpu: true,
          experimentalLearningRate: rate,
          onExperimentalDecision: (report) => decisions.push(report),
          onShotComplete: (report) => completed.push(report),
        });
        match.newMatch();
        match.think();
        expect(decisions.at(-1)).toMatchObject({ observedShots: 0, learnedShots: 0, predictionRms: null, predictionSamples: 0 });
        for (let shot = 1; shot <= 3; shot++) {
          match.fireOwn();
          finishFlight(match);
          expect(completed).toHaveLength(shot);
          const observation = completed.at(-1)!.experimentalObservation!;
          expect(observation).toMatchObject({ learningRate: rate, observedShots: shot });
          expect(observation.learnedShots).toBeCloseTo(shot * rate);
          expect(observation.predictionSamples).toBeGreaterThan(0);
          expect(Number.isFinite(observation.predictionRms)).toBe(true);
          expect(Number.isFinite(observation.fitMs)).toBe(true);
          expect(Number.isFinite(observation.samples)).toBe(true);
          if (rate === 0) expect(observation.retainedShots).toBe(0);
          else if (match.mode === 'classic') expect(observation.retainedShots).toBe(shot);
          // A launch report still describes launch knowledge, not the shot just completed.
          expect(decisions.at(-1)!.shot).toBe(shot);
          expect(decisions.at(-1)!.observedShots).toBe(shot - 1);
          match.trails = [];
          match.think();
          const report = decisions.at(-1)!;
          expect(report.observedShots).toBe(shot);
          expect(report.learnedShots).toBeCloseTo(shot * rate);
          expect(report.learningRate).toBe(rate);
          expect(report.shot).toBe(shot + 1);
          expect(report.mode).toBe(match.mode);
          expect(Number.isFinite(report.fitMs)).toBe(true);
          if (match.mode === 'classic') {
            expect(report.predictionSamples).toBe(observation.predictionSamples);
            expect(report.predictionRms).toBe(observation.predictionRms);
          } else {
            // Collapse preserves observation totals, but invalidates the previous field's
            // diagnostics. The usable shot's forecast is asserted on completion above.
            expect(report.predictionSamples).toBe(0);
            expect(report.predictionRms).toBeNull();
          }
          if (rate === 0) expect(report.retainedShots).toBe(0);
          else if (match.mode === 'classic') expect(report.retainedShots).toBe(shot);
          expect(completed).toHaveLength(shot);
          expect(completed.at(-1)).toMatchObject({ player: 0, shot, volleyShot: 0, outcome: 'timeout', hitShip: null, hitRelation: null });
          expect(completed.at(-1)!.elapsed).toBeGreaterThan(0);
        }
        match.startRound();
        match.think();
        expect(decisions.at(-1)).toMatchObject({ round: 2, observedShots: 0, learnedShots: 0, predictionRms: null });
        match.newMatch();
        match.think();
        expect(decisions.at(-1)).toMatchObject({ round: 1, observedShots: 0, learnedShots: 0, predictionRms: null });
      });
    }

    it(`${Game.name} keeps seeded multi-round worlds independent of variable planner consumption`, () => {
      const options: MatchOptions = { seed: 9153, deterministicCpu: true };
      const a = new Game({ ...settings }, options);
      const b = new Game({ ...settings }, { ...options, experimentalStartingKnowledge: 0, experimentalLearningRate: 0 });
      a.newMatch();
      b.newMatch();
      for (let round = 1; round <= 3; round++) {
        expect(a.world).toEqual(b.world);
        a.think();
        a.fireOwn();
        finishFlight(a);
        a.think();
        a.startRound();
        b.startRound();
      }
      expect(a.world).toEqual(b.world);
    });
  }
  it('reports the terminal shot pre-update prediction without another planning decision', () => {
    const decisions: ExperimentalReport[] = [];
    const completed: CompletedShotReport[] = [];
    const match = new LearningClassic({ ...settings, shotTime: 5 }, {
      seed: 912,
      deterministicCpu: true,
      onExperimentalDecision: (report) => decisions.push(report),
      onShotComplete: (report) => completed.push(report),
    });
    match.newMatch();
    Object.assign(match.world.ships[0], { x: 200, y: 300 });
    Object.assign(match.world.ships[1], { x: 400, y: 300 });
    match.think();
    match.fireOwn(0, 50);
    for (let frame = 0; frame < 300 && match.phase === 'flying'; frame++) match.update(1 / 30);
    expect(match.phase).toBe('roundOver');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ round: 1, player: 0, shot: 1, observedShots: 0, predictionRms: null });
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      round: 1, player: 0, shot: 1, outcome: 'ship', hitShip: 1,
      experimentalObservation: { learningRate: 1, startingKnowledge: 1, observedShots: 1, learnedShots: 1, retainedShots: 1 },
    });
    const observation = completed[0].experimentalObservation!;
    expect(observation.predictionSamples).toBeGreaterThan(0);
    expect(Number.isFinite(observation.predictionRms)).toBe(true);
    match.update(1 / 30);
    match.startRound();
    match.think();
    expect(completed).toHaveLength(1);
    expect(observation.observedShots).toBe(1);
    expect(decisions.at(-1)).toMatchObject({ round: 2, observedShots: 0 });
  });

  it('reports no experimental observation for a normal CPU completed shot', () => {
    const completed: CompletedShotReport[] = [];
    const match = new LearningClassic({ ...settings }, { seed: 912, onShotComplete: (report) => completed.push(report) });
    match.newMatch();
    match.players[0].cpu = 'easy';
    match.fireOwn();
    finishFlight(match);
    expect(completed).toHaveLength(1);
    expect(completed[0].experimentalObservation).toBeNull();
  });

  it('reports zero update time after a sample-free completed shot, not the previous fitted update', () => {
    const completed: CompletedShotReport[] = [];
    const match = new LearningClassic({ ...settings }, { seed: 912, onShotComplete: (report) => completed.push(report) });
    match.newMatch();
    match.fireOwn();
    finishFlight(match);
    const fitted = completed[0].experimentalObservation!;
    expect(fitted.predictionSamples).toBeGreaterThan(0);
    expect(fitted.learnedShots).toBe(1);
    Object.assign(match.world.ships[0], { x: -295, y: 400 });
    match.fireOwn(180, 100);
    finishFlight(match);
    expect(completed).toHaveLength(2);
    expect(completed[1].experimentalObservation).toMatchObject({
      observedShots: 2, learnedShots: 1, retainedShots: 1,
      predictionSamples: 0, predictionRms: null, fitMs: 0,
    });
  });


  for (const Game of [LearningClassic, LearningHorizon]) {
    it(`${Game.name} forwards visible radius and identity but no true masses or hidden planet geometry`, () => {
      const match = new Game({ ...settings, maxPlanets: 1 }, { seed: 7139 });
      match.newMatch();
      const planet = match.world.planets[0];
      Object.defineProperty(planet, 'mass', { get() { throw new Error('private planet mass read'); } });
      const hole = match.world.hole;
      if (hole) Object.defineProperty(hole, 'mass', { get() { throw new Error('private hole mass read'); } });
      const observation = match.observation();
      expect(observation.visiblePlanets).toEqual([{ id: planet.seed, x: planet.x, y: planet.y, radius: planet.radius }]);
      expect(observation.visibleHole).toEqual(hole ? { x: hole.x, y: hole.y, radius: hole.radius } : undefined);
      match.hiddenPlanets = true;
      for (const key of ['x', 'y', 'radius', 'seed'] as const) {
        Object.defineProperty(planet, key, { get() { throw new Error(`private ${key} read`); } });
      }
      expect(match.observation().visiblePlanets).toBeUndefined();
      expect(match.observation().planetCount).toBe(1);
    });
  }

  it('does not report visual extrapolation as an authoritative completed shot', () => {
    const completed: CompletedShotReport[] = [];
    const host = new LearningClassic({ ...settings }, { seed: 912, onShotComplete: (report) => completed.push(report) });
    const guest = new LearningClassic({ ...settings }, { seed: 912, onShotComplete: (report) => completed.push(report) });
    host.newMatch();
    guest.newMatch();
    host.fireOwn();
    guest.restoreSnapshot(host.snapshot());
    for (let frame = 0; frame < 60; frame++) guest.extrapolate(1 / 30);
    expect(completed).toHaveLength(0);
    finishFlight(host);
    expect(completed).toHaveLength(1);
    expect(completed[0].experimentalObservation).toMatchObject({ observedShots: 1 });
    for (let frame = 0; frame < 60; frame++) guest.extrapolate(1 / 30);
    expect(completed).toHaveLength(1);
  });
});

describe('experimental worker match learning', () => {
  for (const Game of [WorkerClassic, WorkerHorizon]) {
    it(`${Game.name} waits for every current fit, reports once, and preserves synchronous diagnostics`, async () => {
      const worker = new MatchWorkerPort();
      const completed: CompletedShotReport[] = [];
      const syncCompleted: CompletedShotReport[] = [];
      const decisions: ExperimentalReport[] = [];
      const mixedSeats: Seat[] = ['experimental-easy', 'experimental-hard', 'off', 'off', 'off', 'off'];
      const config = { ...settings, seats: mixedSeats };
      const match = new Game(config, {
        seed: 7129,
        experimentalWorkerClient: () => new ExperimentalWorkerClient(() => worker),
        onShotComplete: (report) => completed.push(report),
        onExperimentalDecision: (report) => decisions.push(report),
      });
      const Sync = Game === WorkerClassic ? LearningClassic : LearningHorizon;
      const sync = new Sync(config, { seed: 7129, deterministicCpu: true, onShotComplete: (report) => syncCompleted.push(report) });
      match.newMatch();
      sync.newMatch();
      for (const game of [match, sync]) {
        for (const player of game.players) Object.assign(game.world.ships[player.id], { x: 100 + player.id * 200, y: 100 });
        game.firePlayers();
      }
      finishFlight(sync);
      finishWorkerPhysics(match);
      expect(worker.requests.filter((request) => request.kind === 'observe')).toHaveLength(2);
      expect(completed).toHaveLength(0);
      expect(match.finishes).toBe(0);
      const phaseTime = match.phaseTime;
      const clock = match.clock;
      for (let frame = 0; frame < 100; frame++) match.update(1 / 30);
      match.planNow([0, 1]);
      expect(decisions).toHaveLength(0);
      expect(match.clock).toBeGreaterThan(clock);
      expect(match.phaseTime).toBeGreaterThan(phaseTime);
      expect(worker.requests.filter((request) => request.kind === 'observe')).toHaveLength(2);
      worker.processAll();
      while (worker.responses[0]?.kind === 'reset') worker.deliverNext();
      worker.deliverNext();
      for (let step = 0; step < 12; step++) await Promise.resolve();
      expect(completed).toHaveLength(0);
      expect(match.finishes).toBe(0);
      await deliverWorker(worker);
      expect(completed).toHaveLength(2);
      expect(match.finishes).toBe(1);
      for (const [index, report] of completed.entries()) {
        const { fitMs: _fitMs, ...observation } = report.experimentalObservation!;
        const { fitMs: _syncTime, ...syncObservation } = syncCompleted[index].experimentalObservation!;
        expect(observation).toEqual(syncObservation);
        expect(report).toMatchObject({ player: index, shot: 1, outcome: 'timeout' });
        expect(observation.predictionSamples).toBeGreaterThan(0);
        expect(Number.isFinite(observation.predictionRms)).toBe(true);
      }
      finishFlight(match);
      if (match.mode === 'horizon') {
        match.planNow([0, 1]);
        expect(decisions).toHaveLength(0);
        expect(worker.requests.filter((request) => request.kind === 'advance')).toHaveLength(2);
        await deliverWorker(worker);
      }
      match.trails = [];
      match.planNow([0, 1]);
      expect(decisions).toHaveLength(2);
      for (const [player, rate] of [0.45, 0.72].entries()) {
        expect(decisions.find((report) => report.player === player)).toMatchObject({ observedShots: 1, learnedShots: rate, startingKnowledge: player === 0 ? 0.5 : 0.9 });
      }
      expect(completed).toHaveLength(2);
      expect(match.finishes).toBe(1);
      match.dispose();
      sync.dispose();
      expect(worker.terminated).toBe(true);
    });

    for (const reset of ['round', 'match', 'restore'] as const) {
      it(`${Game.name} ignores a stale completed fit after ${reset}`, async () => {
        const worker = new MatchWorkerPort();
        const completed: CompletedShotReport[] = [];
        const decisions: ExperimentalReport[] = [];
        const match = new Game({ ...settings }, {
          seed: 7129,
          experimentalWorkerClient: () => new ExperimentalWorkerClient(() => worker),
          onShotComplete: (report) => completed.push(report),
          onExperimentalDecision: (report) => decisions.push(report),
        });
        match.newMatch();
        const openingClassic = match instanceof WorkerClassic ? match.snapshot() : null;
        const openingHorizon = match instanceof WorkerHorizon ? match.snapshot() : null;
        match.fireOwn();
        finishWorkerPhysics(match);
        worker.processAll();
        if (reset === 'round') match.startRound();
        else if (reset === 'match') match.newMatch();
        else if (match instanceof WorkerClassic) match.restoreSnapshot(openingClassic!);
        else match.restoreSnapshot(openingHorizon!);
        await deliverWorker(worker);
        expect(completed).toHaveLength(0);
        expect(match.finishes).toBe(0);
        expect(match.phase).toBe('aiming');
        match.planNow();
        expect(decisions.at(-1)).toMatchObject({ observedShots: 0, learnedShots: 0, retainedShots: 0, predictionSamples: 0, predictionRms: null });
        match.fireOwn();
        finishWorkerPhysics(match);
        await deliverWorker(worker);
        expect(completed).toHaveLength(1);
        expect(completed[0].experimentalObservation).toMatchObject({ observedShots: 1, learnedShots: 1 });
        expect(match.finishes).toBe(1);
        match.dispose();
      });
    }

    it(`${Game.name} surfaces worker errors before planning or publishing a completion`, async () => {
      const worker = new MatchWorkerPort();
      const completed: CompletedShotReport[] = [];
      const match = new Game({ ...settings }, {
        seed: 7129,
        experimentalWorkerClient: () => new ExperimentalWorkerClient(() => worker),
        onShotComplete: (report) => completed.push(report),
      });
      match.newMatch();
      match.fireOwn();
      finishWorkerPhysics(match);
      worker.onerror?.({ message: 'observation worker failed' });
      for (let step = 0; step < 12; step++) await Promise.resolve();
      expect(() => match.update(1 / 30)).toThrow('observation worker failed');
      expect(completed).toHaveLength(0);
      expect(match.finishes).toBe(0);
      match.dispose();
    });
  }

  it('reports a terminal worker-updated shot exactly once without another aim', async () => {
    const worker = new MatchWorkerPort();
    const completed: CompletedShotReport[] = [];
    const match = new WorkerClassic({ ...settings, shotTime: 5 }, {
      seed: 912,
      experimentalWorkerClient: () => new ExperimentalWorkerClient(() => worker),
      onShotComplete: (report) => completed.push(report),
    });
    match.newMatch();
    Object.assign(match.world.ships[0], { x: 200, y: 300 });
    Object.assign(match.world.ships[1], { x: 400, y: 300 });
    match.fireOwn(0, 50);
    finishWorkerPhysics(match);
    expect(completed).toHaveLength(0);
    await deliverWorker(worker);
    expect(match.phase).toBe('roundOver');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ outcome: 'ship', hitShip: 1, experimentalObservation: { observedShots: 1, learnedShots: 1, retainedShots: 1 } });
    expect(completed[0].experimentalObservation!.predictionSamples).toBeGreaterThan(0);
    const observation = { ...completed[0].experimentalObservation };
    for (let frame = 0; frame < 100; frame++) match.update(1 / 30);
    match.startRound();
    await deliverWorker(worker);
    expect(completed).toHaveLength(1);
    expect(completed[0].experimentalObservation).toEqual(observation);
    match.dispose();
  });

  it('keeps deterministic matches synchronous even with an injected worker factory', () => {
    let workerCreations = 0;
    const completed: CompletedShotReport[] = [];
    const match = new LearningClassic({ ...settings }, {
      seed: 7129,
      deterministicCpu: true,
      experimentalWorkerClient: () => {
        workerCreations++;
        return new ExperimentalWorkerClient(() => new MatchWorkerPort());
      },
      onShotComplete: (report) => completed.push(report),
    });
    match.newMatch();
    match.fireOwn();
    finishFlight(match);
    expect(workerCreations).toBe(0);
    expect(completed).toHaveLength(1);
    expect(completed[0].experimentalObservation).toMatchObject({ observedShots: 1, learnedShots: 1 });
    match.dispose();
  });
});
