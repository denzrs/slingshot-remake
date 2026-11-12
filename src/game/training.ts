import { DEFAULT_SETTINGS, cloneSettings, type Settings } from '../data/settings';
import { rulesOf } from '../data/roomRules';
import { ClassicMatch } from './classic';
import { newPlayer, type Scene } from './match';
import { t } from '../platform/i18n';
import { previewPath } from '../sim/powerups';

export type TrainingStep = 'angle' | 'power' | 'shot' | 'gravity' | 'done';

const DIRECT_AIM = { angle: 0, power: 70 };
const GRAVITY_AIM = { angle: 24, power: 75 };

/** Only the pilot gets a turn; the other body is a target, as in a Daily sector. */
class PracticeMatch extends ClassicMatch {
  /** The flight preview, switched by the player. A real game has none unless it is picked up as a power-up. */
  showPreview = true;
  private previewKey = '';
  private previewCache: number[] | null = null;

  get practice(): boolean {
    return true;
  }

  protected afterVolley(): void {
    this.current = 0;
    this.setPhase('aiming');
  }

  scene(): Scene {
    let preview: number[] | null = null;
    if (this.phase === 'aiming' && this.showPreview) {
      const p = this.players[0];
      const s = this.world.ships[0];
      const key = `${p.angle}|${p.power}|${s.x}|${s.y}|${this.world.planets.length}`;
      if (key !== this.previewKey) {
        this.previewKey = key;
        this.previewCache = previewPath(this.world, 0, p.angle, p.power, this.rules);
      }
      preview = this.previewCache;
    }
    return { ...super.scene(), preview };
  }
}

/**
 * The first real game after the tutorial: one step beyond the drone. One opponent that fires back, taking turns,
 * with the player's own look and device settings but none of the extra rules. It leaves the saved setup alone.
 */
export function firstDuelSettings(settings: Settings): Settings {
  return {
    ...cloneSettings(settings),
    ...rulesOf(DEFAULT_SETTINGS),
    seats: ['human', 'easy', 'off', 'off', 'off', 'off'],
    rounds: 3, powerUps: false, anomalies: [], mayhem: 0, betting: false,
    simultaneousShots: false, hiddenAim: false, teamMode: 0,
  };
}

/** A local practice field: real aiming, flights and collisions, with no opponent turn or time pressure. */
export class Training {
  match!: PracticeMatch;
  step: TrainingStep = 'angle';
  misses = 0;
  /**
   * The flight preview, which the player may switch. The first lesson starts with it to show what angle and power do;
   * the planet lesson starts without it, as a real game does, where it is a power-up.
   */
  preview = true;
  private gravity = false;
  private fired = false;
  private retryIn = 0;
  private touchedAngle = false;
  private touchedPower = false;

  constructor(private readonly settings: Settings = DEFAULT_SETTINGS) {
    this.resetField();
  }

  private resetField(): void {
    const previous = this.match;
    const aim = previous?.players[0];
    const settings: Settings = {
      ...cloneSettings(this.settings),
      ...rulesOf(DEFAULT_SETTINGS),
      seats: ['human', 'easy', 'off', 'off', 'off', 'off'],
      rounds: 1, maxPlanets: 0, powerUps: false, anomalies: [], mayhem: 0,
      betting: false, simultaneousShots: false, hiddenAim: false, suddenDeath: false,
      killcam: 'off', shotTime: 6, teamMode: 0,
    };
    this.match = new PracticeMatch(settings, { seed: 731, names: [t('onboarding.you')] });
    this.match.newMatch();
    this.match.players[1] = newPlayer(1, 1, 'easy', null, true, t('onboarding.target'));
    this.match.phase = 'aiming';
    this.match.phaseTime = 10;
    this.match.current = 0;
    this.match.world.ships[0].x = 220;
    this.match.world.ships[0].y = 350;
    this.match.world.ships[1].x = 1040;
    this.match.world.ships[1].y = 350;
    if (this.gravity) this.match.world.planets.push({
      x: 630, y: 350, radius: 70, mass: 70 ** 3,
      seed: 21, style: 'rocky', tint: '#a89585',
    });
    this.match.players[0].angle = aim?.angle ?? 18;
    this.match.players[0].power = aim?.power ?? 50;
    this.match.trails = previous?.world.planets.length === this.match.world.planets.length ? previous.trails : [];
    this.match.showPreview = this.preview;
    previous?.dispose();
    this.fired = false;
    this.retryIn = 0;
    this.touchedAngle = false;
    this.touchedPower = false;
  }

  get aiming(): boolean {
    return !this.fired && this.step !== 'done';
  }

  /** The planet lesson's known working aim, spelled out, since that lesson has no flight preview. */
  get suggestedAim(): Readonly<typeof GRAVITY_AIM> | null {
    return this.gravity && this.step !== 'done' ? GRAVITY_AIM : null;
  }

  setAim(angle: number, power: number): void {
    if (!this.aiming) return;
    const before = this.match.players[0];
    const changedAngle = angle !== before.angle;
    const changedPower = power !== before.power;
    this.match.setPlayerAim(0, angle, power);
    if (changedAngle) this.touchedAngle = true;
    if (changedPower) this.touchedPower = true;
    if (this.step === 'angle' || this.step === 'power') {
      if (this.touchedAngle && this.touchedPower) this.step = 'shot';
      else if (this.touchedAngle) this.step = 'power';
    }
  }

  fire(): void {
    if (!this.aiming || this.step === 'angle' || this.step === 'power') return;
    this.match.commit();
    this.fired = this.match.phase === 'flying';
  }

  togglePreview(): void {
    if (this.step === 'done') return;
    this.preview = !this.preview;
    this.match.showPreview = this.preview;
  }

  /** A known working aim, offered without firing or completing the exercise for the player. */
  assist(): void {
    if (!this.aiming) return;
    const aim = this.gravity ? GRAVITY_AIM : DIRECT_AIM;
    this.match.setPlayerAim(0, aim.angle, aim.power);
    this.touchedAngle = true;
    this.touchedPower = true;
    if (this.step === 'angle' || this.step === 'power') this.step = 'shot';
  }

  update(dt: number): void {
    if (!this.fired) {
      this.match.clock += dt;
      this.match.phaseTime += dt;
      return;
    }
    if (this.retryIn > 0) {
      this.retryIn -= dt;
      if (this.retryIn <= 0) this.resetField();
      return;
    }
    this.match.update(dt);
    if (!this.match.world.ships[1].alive) {
      if (this.gravity) {
        this.step = 'done';
        this.fired = false;
      } else {
        this.gravity = true;
        this.preview = false;
        this.step = 'gravity';
        this.misses = 0;
        this.retryIn = 1;
      }
    } else if (this.match.phase !== 'flying' || this.match.current !== 0) {
      this.misses++;
      this.retryIn = 0.8;
    }
  }

  dispose(): void {
    this.match.dispose();
  }
}
