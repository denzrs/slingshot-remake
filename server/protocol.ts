export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isIndex = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** A client's aim/fire request, as the host will apply it. */
export function isInputMessage(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'adjust':
      return isFiniteNumber(value.dAngle) && isFiniteNumber(value.dPower);
    case 'aim':
      return isFiniteNumber(value.angle) && isFiniteNumber(value.power);
    case 'fire':
    case 'skip':
      return true;
    default:
      return false;
  }
}

/** A game event the host relays to the guests (sounds and effects are driven from these). */
export function isGameEvent(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'round':
    case 'gameOver':
    case 'roundEnd':
    case 'volley':
    case 'collapse':
      return true;
    case 'killcam':
      return typeof value.active === 'boolean' && typeof value.recording === 'boolean';
    case 'turn':
    case 'lock':
      return isIndex(value.player);
    case 'fire':
      return isIndex(value.player) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.angle) && isFiniteNumber(value.power);
    case 'impact':
      return isIndex(value.player) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.vx) && isFiniteNumber(value.vy);
    case 'explode':
      return isFiniteNumber(value.x) && isFiniteNumber(value.y) && isIndex(value.ship) && isFiniteNumber(value.vx) && isFiniteNumber(value.vy);
    case 'fizzle':
      return isIndex(value.player) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.vx) && isFiniteNumber(value.vy) && typeof value.lost === 'boolean';
    case 'clash':
      return isFiniteNumber(value.x) && isFiniteNumber(value.y) && Array.isArray(value.players) && value.players.length === 2 && value.players.every(isIndex)
        && Array.isArray(value.velocities) && value.velocities.length === 2
        && value.velocities.every((v) => isRecord(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y));
    case 'devour':
      return isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.toX) && isFiniteNumber(value.toY)
        && typeof value.color === 'string' && isFiniteNumber(value.vx) && isFiniteNumber(value.vy);
    case 'style':
      return isIndex(value.player) && typeof value.kind === 'string' && isFiniteNumber(value.x) && isFiniteNumber(value.y);
    case 'kill':
      return isRecord(value.record);
    default:
      return false;
  }
}

/** The rules of an online game, chosen by whoever creates (and later edits) the room. */
export interface RoomRules {
  /** 0 = endless. */
  rounds: number;
  maxPlanets: number;
  invisiblePlanets: boolean;
  bounce: boolean;
  fixedPower: boolean;
  /** Highest power a shot may be fired with (100 = no cap). */
  maxPower: number;
  /** Seconds before a shot fizzles out. */
  shotTime: number;
  /** Classic only: trick shots multiply a hit's points. */
  styleBonuses: boolean;
  /** Four or more ships: the shooter's first this many shots of a round (0 = off) pass through its nearest enemy. */
  neighborGrace: number;
  /** Classic only: everybody aims at once and all shots fly together. */
  simultaneousShots: boolean;
  /** Everybody sees only their own aim, not the opponents'. */
  hiddenAim: boolean;
  /** Seconds a finished shot's flight path stays on the board (0 = for good). */
  fadingTrails: number;
}

export const DEFAULT_RULES: RoomRules = {
  rounds: 5,
  maxPlanets: 4,
  invisiblePlanets: false,
  bounce: false,
  fixedPower: false,
  maxPower: 100,
  shotTime: 20,
  styleBonuses: false,
  neighborGrace: 0,
  simultaneousShots: false,
  hiddenAim: false,
  fadingTrails: 0,
};

const isIntBetween = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/** Validates untrusted rules from a client; null when anything is off. */
export function parseRules(value: unknown): RoomRules | null {
  if (!isRecord(value)) return null;
  const { rounds, maxPlanets, invisiblePlanets, bounce, fixedPower, shotTime, styleBonuses, neighborGrace, simultaneousShots, hiddenAim, fadingTrails } = value;
  // Clients from before the cap existed don't send it.
  const maxPower = value.maxPower ?? 100;
  if (!isIntBetween(rounds, 0, 99) || !isIntBetween(maxPlanets, 1, 8) || !isIntBetween(shotTime, 5, 120)) return null;
  if (![invisiblePlanets, bounce, fixedPower, styleBonuses, simultaneousShots, hiddenAim].every((flag) => typeof flag === 'boolean')) return null;
  if (typeof neighborGrace !== 'number' || ![0, 1, 2].includes(neighborGrace)) return null;
  if (typeof maxPower !== 'number' || ![10, 20, 30, 40, 50, 60, 70, 80, 90, 100].includes(maxPower)) return null;
  if (typeof fadingTrails !== 'number' || ![0, 1, 2, 4].includes(fadingTrails)) return null;
  return { rounds, maxPlanets, invisiblePlanets: invisiblePlanets as boolean, bounce: bounce as boolean, fixedPower: fixedPower as boolean, maxPower, shotTime, styleBonuses: styleBonuses as boolean, neighborGrace, simultaneousShots: simultaneousShots as boolean, hiddenAim: hiddenAim as boolean, fadingTrails };
}
