import { describe, expect, it } from 'vitest';
import { firstDuelSettings, Training } from '../../src/game/training';
import { cloneSettings, DEFAULT_SETTINGS } from '../../src/data/settings';

function fly(training: Training, seconds = 5): void {
  for (let i = 0; i < seconds * 120; i++) training.update(1 / 120);
}

function learnAim(training: Training): void {
  training.setAim(0, 50);
  training.setAim(0, 70);
}

describe('interactive flight training', () => {
  it('has one human pilot and a stationary Daily-style target drone', () => {
    const training = new Training();
    expect(training.match.humanCount).toBe(1);
    expect(training.match.players[1].target).toBe(true);
    expect(training.match.canAim(1)).toBe(false);
    expect(training.match.settings.seats[1]).not.toBe('human');
    training.dispose();
  });

  it('puts the gravity planet directly between pilot and drone, without a preview, and its hint hits', () => {
    const training = new Training();
    learnAim(training);
    training.fire();
    fly(training);
    const [pilot, drone] = training.match.world.ships;
    const planet = training.match.world.planets[0];
    expect(planet.x).toBe((pilot.x + drone.x) / 2);
    expect(planet.y).toBe((pilot.y + drone.y) / 2);
    expect(training.match.trails).toHaveLength(0);
    // As in a real game, where the preview is a power-up: the lesson spells out its hint instead.
    expect(training.match.scene().preview).toBeNull();
    const hint = training.suggestedAim!;
    training.setAim(hint.angle, hint.power);
    training.fire();
    fly(training);
    expect(training.step).toBe('done');
    expect(training.suggestedAim).toBeNull();
    training.dispose();
  });

  it('uses practice rules even when the saved match has fixed power, a low cap or hidden planets', () => {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    Object.assign(settings, { fixedPower: true, maxPower: 10, invisiblePlanets: true, contours: false, betting: true });
    const training = new Training(settings);
    expect(training.match.settings.contours).toBe(false);
    expect(training.match.settings.fixedPower).toBe(false);
    expect(training.match.settings.invisiblePlanets).toBe(false);
    expect(training.match.settings.betting).toBe(false);
    learnAim(training);
    training.fire();
    fly(training);
    expect(training.step).toBe('gravity');
    expect(training.match.players[0].power).toBe(70);
    expect(settings.fixedPower).toBe(true);
    expect(settings.maxPower).toBe(10);
    training.dispose();
  });

  it('waits for an angle and power change before allowing the first shot', () => {
    const training = new Training();
    training.fire();
    expect(training.match.phase).toBe('aiming');
    training.setAim(0, 50);
    expect(training.step).toBe('power');
    training.fire();
    expect(training.match.phase).toBe('aiming');
    training.setAim(0, 70);
    training.fire();
    expect(training.match.phase).toBe('flying');
    training.dispose();
  });

  it('moves to a gravity field after a real hit, and finishes after the second real hit', () => {
    const training = new Training();
    learnAim(training);
    training.fire();
    fly(training);
    expect(training.step).toBe('gravity');
    expect(training.match.world.planets).toHaveLength(1);
    expect(training.match.world.ships.every((ship) => ship.alive)).toBe(true);
    training.assist();
    expect(training.step).toBe('gravity');
    training.fire();
    fly(training);
    expect(training.step).toBe('done');
    expect(training.match.world.ships[1].alive).toBe(false);
    expect(training.match.world.ships[0].alive).toBe(true);
    training.dispose();
  });

  it('keeps the last aim and flight trail after a miss, with no opponent turn', () => {
    const training = new Training();
    learnAim(training);
    training.setAim(30, 70);
    training.fire();
    fly(training, 9);
    expect(training.step).toBe('shot');
    expect(training.misses).toBe(1);
    expect(training.aiming).toBe(true);
    expect(training.match.current).toBe(0);
    expect(training.match.players[0].angle).toBe(30);
    expect(training.match.trails.length).toBeGreaterThan(0);
    training.assist();
    training.fire();
    fly(training);
    expect(training.step).toBe('gravity');
    training.dispose();
  });

  it('provides a dynamic flight preview matching the preview power-up that responds to aim changes', () => {
    const training = new Training();
    const scene1 = training.match.scene();
    expect(scene1.preview).toBeDefined();
    expect(scene1.preview!.length).toBeGreaterThan(10);
    const initialPoints = [...scene1.preview!];

    // Changing angle alters the preview polyline
    training.setAim(45, 50);
    const scene2 = training.match.scene();
    expect(scene2.preview).toBeDefined();
    expect(scene2.preview).not.toEqual(initialPoints);

    // During flight, the preview disappears
    training.setAim(0, 70);
    training.fire();
    expect(training.match.scene().preview).toBeNull();
    training.dispose();
  });

  it('follows with a first duel: one opponent that fires back, turns, no extra rules, the saved setup untouched', () => {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    Object.assign(settings, { look: 'holo', powerUps: true, mayhem: 2, simultaneousShots: true, rounds: 9 });
    const duel = firstDuelSettings(settings);
    expect(duel.seats.filter((seat) => seat !== 'off')).toEqual(['human', 'easy']);
    expect(duel).toMatchObject({ look: 'holo', powerUps: false, mayhem: 0, simultaneousShots: false, rounds: 3, anomalies: [] });
    expect(duel.shotTime).toBeGreaterThan(0);
    expect(settings).toMatchObject({ powerUps: true, mayhem: 2, rounds: 9 });
  });

  it('lets the player switch the preview, which the planet lesson starts without', () => {
    const training = new Training();
    expect(training.match.scene().preview).not.toBeNull();
    training.togglePreview();
    expect(training.match.scene().preview).toBeNull();
    training.togglePreview();
    learnAim(training);
    training.fire();
    fly(training);
    expect(training.step).toBe('gravity');
    expect(training.preview).toBe(false);
    expect(training.match.scene().preview).toBeNull();
    training.togglePreview();
    expect(training.match.scene().preview!.length).toBeGreaterThan(10);
    // A miss keeps the player's choice for the next try.
    training.setAim(180, 60);
    training.fire();
    fly(training, 12);
    expect(training.misses).toBe(1);
    expect(training.preview).toBe(true);
    expect(training.match.scene().preview).not.toBeNull();
    training.dispose();
  });
});
