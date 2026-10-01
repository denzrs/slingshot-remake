import { describe, expect, it } from 'vitest';
import { FIELD } from '../src/config';
import { Game } from '../src/game';
import { DEFAULT_SETTINGS } from '../src/settings';
import { generateWorld } from '../src/world';

describe('six-player game modes', () => {
  it('generates six distinct ships inside the field', () => {
    const world = generateWorld(42, 4, 6);
    expect(world.ships).toHaveLength(6);
    expect(new Set(world.ships.map(({ x, y }) => `${x},${y}`)).size).toBe(6);
    for (const ship of world.ships) {
      expect(ship.x).toBeGreaterThanOrEqual(0);
      expect(ship.x).toBeLessThanOrEqual(FIELD.width);
      expect(ship.y).toBeGreaterThanOrEqual(0);
      expect(ship.y).toBeLessThanOrEqual(FIELD.height);
    }
  });

  it('rotates a lost shot through all six FFA players', () => {
    const game = new Game({ ...DEFAULT_SETTINGS, rounds: 3 }, { playerCount: 6, mode: 'ffa', seed: 7 });
    game.world = {
      width: FIELD.width,
      height: FIELD.height,
      planets: [],
      ships: Array.from({ length: 6 }, (_, id) => ({ x: 100 + id * 200, y: 400 })),
    };

    for (let shooter = 0; shooter < 6; shooter++) {
      expect(game.current).toBe(shooter);
      game.setAimFor(shooter, 90, 100);
      game.fireFor(shooter);
      for (let frame = 0; frame < 40 && game.phase === 'flying'; frame++) game.update(0.05);
      expect(game.phase).toBe('aiming');
      expect(game.current).toBe((shooter + 1) % 6);
    }
  });

  it('sums alternating player scores into the two team totals', () => {
    const game = new Game({ ...DEFAULT_SETTINGS, rounds: 3 }, { playerCount: 6, mode: 'team', seed: 9 });
    game.players.forEach((player, id) => (player.score = (id + 1) * 100));

    expect(game.teamScores).toEqual([900, 1200]);
    expect(game.winningTeam).toBe(1);
    expect(game.leader).toBeNull();
  });

  it('restores authoritative mid-flight snapshots without guest simulation', () => {
    const host = new Game({ ...DEFAULT_SETTINGS, rounds: 3 }, { playerCount: 6, mode: 'team', seed: 11, network: true, localPlayerId: 0 });
    const guest = new Game({ ...DEFAULT_SETTINGS, rounds: 3 }, { playerCount: 6, mode: 'team', seed: 11, network: true, localPlayerId: 1 });
    host.setAimFor(0, 17, 75);
    host.fireFor(0);
    for (let frame = 0; frame < 5; frame++) host.update(0.05);

    guest.restoreSnapshot(host.snapshot());
    const authoritative = guest.snapshot();
    expect(authoritative.shot?.x).toBe(host.shot?.x);
    expect(authoritative.shot?.y).toBe(host.shot?.y);
    expect(authoritative.phase).toBe('flying');

    guest.update(10);
    expect(guest.snapshot()).toEqual(authoritative);
  });
});
