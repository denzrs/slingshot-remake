import { describe, expect, it } from 'vitest';
import { dailyChallenge } from '../src/challenge';
import { createChallenge, createMatch, ClassicMatch, HorizonMatch, type GameEvent, type Match, type Mode, type VersusMode } from '../src/game';
import { cloneWorld } from '../src/physics';
import { SnapshotDecoder, SnapshotEncoder } from '../src/netsync';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';

const dt = 1 / 60;
const modes: VersusMode[] = ['classic', 'solar', 'horizon'];

function make(mode: Mode, count = 2, salvo = false): Match {
  const seats: Seat[] = Array.from({ length: 6 }, (_, i) => i < count ? 'human' : 'off');
  const settings = { ...DEFAULT_SETTINGS, seats, rounds: 1, maxPlanets: 0, neighborGrace: 0, bounce: false, fixedPower: false, shotTime: 3, simultaneousShots: salvo, powerUps: true, killcam: 'every' as const };
  const m = mode === 'challenge' ? createChallenge(settings, dailyChallenge('2026-10-09')) : createMatch(mode, settings, { seats, seed: 7, simultaneous: true });
  m.world.planets = [];
  m.world.nebulae = [];
  m.world.defenses = [];
  m.world.wormholes = [];
  m.pickups = [];
  for (const hole of m.world.holes) hole.mass = 0;
  m.world.ships.forEach((ship, i) => Object.assign(ship, { x: i === 0 ? 100 : i === 1 ? 300 : 1000, y: i < 2 ? 100 : 600 }));
  return m;
}

function until(m: Match, done: () => boolean, seconds = 30): void {
  for (let i = 0; i < seconds / dt && !done(); i++) m.update(dt);
  expect(done(), `phase: ${m.phase}`).toBe(true);
}

function fire(m: Match, angle = 0): void {
  if (m instanceof HorizonMatch || (m instanceof ClassicMatch && m.salvo)) {
    for (const p of m.players) {
      m.setPlayerAim(p.id, p.id === 0 ? angle : 90, 50);
      m.commitPlayer(p.id);
    }
  } else {
    m.setAim(angle, 50);
    m.commit();
  }
}

function networkMatch(mode: VersusMode, count = 2): ClassicMatch | HorizonMatch {
  const m = make(mode, count);
  if (m instanceof ClassicMatch || m instanceof HorizonMatch) return m;
  throw new Error('Expected a network match');
}

describe('shared killcams', () => {
  it.each(modes)('replays a %s kill automatically and resumes without scoring it twice', (mode) => {
    const m = make(mode);
    const events: GameEvent[] = [];
    m.on((event) => events.push(event));
    fire(m);
    until(m, () => m.phase === 'killcam');
    expect(m.killcamInfo?.clip.record).toMatchObject({ killer: 0, victim: 1 });
    expect(m.scene().world).not.toBe(m.world);
    expect(m.scene().camera).not.toBeNull();
    const world = cloneWorld(m.world);
    const scores = m.players.map((p) => p.score);
    const stats = structuredClone(m.matchStats);
    until(m, () => m.scene().world.ships[1].alive === false);
    expect(m.world).toEqual(world);
    expect(m.players.map((p) => p.score)).toEqual(scores);
    expect(m.matchStats).toEqual(stats);
    expect(events.filter((event) => event.type === 'kill')).toHaveLength(1);
    until(m, () => m.phase !== 'killcam');
    expect(m.phase).toBe(mode === 'horizon' ? 'collapse' : 'roundOver');
    until(m, () => m.phase === 'roundOver');
    expect(events.filter((event) => event.type === 'roundEnd')).toHaveLength(1);
  });

  it.each(modes)('leaves %s misses without a killcam', (mode) => {
    const m = make(mode);
    const starts: GameEvent[] = [];
    m.on((event) => { if (event.type === 'killcam') starts.push(event); });
    fire(m, 90);
    until(m, () => m.phase === 'flying');
    until(m, () => m.phase !== 'flying');
    expect(m.phase).not.toBe('killcam');
    expect(m.canReplay).toBe(false);
    expect(starts).toEqual([]);
  });

  it.each(modes)('records a %s killcam and returns to the summary without repeating the result', (mode) => {
    const m = make(mode);
    const events: GameEvent[] = [];
    m.on((event) => events.push(event));
    fire(m);
    until(m, () => m.phase === 'killcam');
    // Replacing the automatic playback with a recording keeps its pending mode transition.
    expect(m.replayLastKill(true)).toBe(true);
    m.update(0.5);
    m.advance();
    m.voteSkip(0);
    expect(m.phase).toBe('killcam');
    expect(m.canReplay).toBe(false);
    until(m, () => m.phase === 'roundOver');
    const scores = m.players.map((p) => p.score);
    const summary = structuredClone(m.summary);
    const stats = structuredClone(m.matchStats);
    expect(m.replayLastKill(true)).toBe(true);
    until(m, () => m.phase === 'roundOver');
    expect(m.players.map((p) => p.score)).toEqual(scores);
    expect(m.summary).toEqual(summary);
    expect(m.matchStats).toEqual(stats);
    expect(events.filter((e) => e.type === 'roundEnd')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'killcam' && e.recording && !e.active)).toHaveLength(2);
  });

  it('hands Classic to the next player after skipping a non-final kill', () => {
    const m = make('classic', 3);
    fire(m);
    until(m, () => m.phase === 'killcam');
    m.update(0.5);
    m.voteSkip(99);
    expect(m.killcamInfo?.votes).toBe(0);
    m.voteSkip(0);
    m.voteSkip(0);
    expect(m.killcamInfo?.votes).toBe(1);
    m.voteSkip(2);
    expect(m.phase).toBe('aiming');
    expect(m.current).toBe(2);
  });

  it('holds Solar orbits still until the killcam ends', () => {
    const m = make('solar', 3, true);
    fire(m);
    until(m, () => m.phase === 'killcam');
    const ships = structuredClone(m.world.ships);
    m.update(0.5);
    expect(m.world.ships).toEqual(ships);
    m.advance();
    expect(m.phase).toBe('orbit');
    until(m, () => m.phase === 'aiming');
    expect(m.world.ships[0]).not.toEqual(ships[0]);
  });
});

describe('killcam snapshots', () => {
  it.each<VersusMode>(['classic', 'solar', 'horizon'])('restores the remaining %s post-flight delay', (mode) => {
    const host = networkMatch(mode);
    fire(host);
    until(host, () => host.phase === 'flying' && !!host.volley?.done);
    host.update(0.75);
    expect(host.phase).toBe('flying');
    const guest = networkMatch(mode);
    const state = JSON.parse(JSON.stringify(host.snapshot()));
    guest.restoreSnapshot(state);
    host.update(0.3);
    guest.update(0.3);
    expect(guest.phase).toBe('killcam');
    expect(guest.lastClip).toEqual(host.lastClip);
  });

  it.each<VersusMode>(['classic', 'solar', 'horizon'])('restores %s splitter playback through encoded network patches', (mode) => {
    const host = networkMatch(mode);
    host.players[0].powerUp = 'splitter';
    host.players[0].armed = true;
    fire(host);
    until(host, () => host.phase === 'flying');
    host.update(0.05);
    host.commitPlayer(0);
    until(host, () => host.phase === 'killcam');
    expect(host.lastClip?.script?.some((entry) => entry.kind === 'split')).toBe(true);
    const encoder = new SnapshotEncoder();
    const decoder = new SnapshotDecoder();
    const guest = networkMatch(mode);
    let sawForks = false;
    let sawHit = false;
    for (let frame = 0; frame < 1800 && host.phase === 'killcam'; frame++) {
      host.update(dt);
      const rebuilt = decoder.apply(JSON.parse(JSON.stringify(encoder.encode(host.snapshot()))));
      expect(rebuilt).not.toBeNull();
      guest.restoreSnapshot(JSON.parse(JSON.stringify(rebuilt)));
      expect(guest.scene().world.ships).toEqual(host.scene().world.ships);
      expect(guest.scene().volley?.shots.length).toBe(host.scene().volley?.shots.length);
      if (host.phase === 'killcam') {
        sawForks ||= (host.scene().volley?.shots.length ?? 0) > (mode === 'horizon' ? 2 : 1);
        sawHit ||= !host.scene().world.ships[1].alive;
      }
    }
    expect(sawForks).toBe(true);
    expect(sawHit).toBe(true);
    expect(guest.phase).toBe(host.phase);
  });
});

describe('killcam preferences', () => {
  it.each(modes)('uses salvo-only defaults in %s and allows disabling them', (mode) => {
    const m = make(mode);
    m.settings.killcam = DEFAULT_SETTINGS.killcam;
    fire(m);
    until(m, () => m.phase === 'flying');
    until(m, () => m.phase !== 'flying');
    expect(m.phase === 'killcam').toBe(mode === 'horizon');

    const disabled = make(mode, 2, true);
    disabled.settings.killcam = 'off';
    fire(disabled);
    until(disabled, () => disabled.phase === 'flying');
    until(disabled, () => disabled.phase !== 'flying');
    expect(disabled.phase).not.toBe('killcam');
  });

  it.each<VersusMode>(['classic', 'solar'])('automatically enables %s killcams when simultaneous shots are on', (mode) => {
    const m = make(mode, 2, true);
    m.settings.killcam = 'auto';
    fire(m);
    until(m, () => m.phase === 'killcam');
  });

  it.each(['auto', 'off', 'every', 'round'] as const)('keeps Daily Challenge killcams off even with %s selected', (killcam) => {
    const m = make('challenge');
    m.settings.killcam = killcam;
    const events: GameEvent[] = [];
    m.on((event) => events.push(event));
    fire(m);
    until(m, () => m.phase === 'roundOver');
    expect(m.canReplay).toBe(false);
    expect(m.replayLastKill(true)).toBe(false);
    expect(events.some((event) => event.type === 'killcam')).toBe(false);
  });

  it.each(modes)('plays one %s round-end killcam, then returns to the completed result', (mode) => {
    const m = make(mode);
    m.settings.killcam = 'round';
    const events: GameEvent[] = [];
    m.on((event) => events.push(event));
    fire(m);
    until(m, () => m.phase === 'killcam');
    expect(m.summary).not.toBeNull();
    if (mode === 'horizon') {
      // Event Horizon can also decide the round during collapse; replay only after that transition.
      expect(events.findIndex((e) => e.type === 'collapse')).toBeLessThan(events.findIndex((e) => e.type === 'killcam'));
    }
    const scores = m.players.map((p) => p.score);
    until(m, () => m.phase === 'roundOver');
    expect(m.players.map((p) => p.score)).toEqual(scores);
    expect(m.scoreHistory).toHaveLength(2);
    expect(events.filter((event) => event.type === 'roundEnd')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'killcam' && event.active)).toHaveLength(1);
  });

  it.each<VersusMode>(['classic', 'solar'])('waits through non-final %s kills and replays the final kill of the round', (mode) => {
    const m = make(mode, 3);
    m.settings.killcam = 'round';
    Object.assign(m.world.ships[2], { x: 500, y: 100 });
    const events: GameEvent[] = [];
    m.on((event) => events.push(event));
    fire(m);
    until(m, () => m.phase === 'flying');
    until(m, () => m.phase !== 'flying');
    expect(m.phase).toBe('aiming');
    expect(m.current).toBe(2);
    expect(events.some((event) => event.type === 'killcam')).toBe(false);
    m.setAim(180, 50);
    m.commit();
    until(m, () => m.phase === 'killcam');
    expect(m.lastClip?.record).toMatchObject({ killer: 2, victim: 0 });
    until(m, () => m.phase === 'roundOver');
    expect(events.filter((event) => event.type === 'killcam' && event.active)).toHaveLength(1);
  });
});
