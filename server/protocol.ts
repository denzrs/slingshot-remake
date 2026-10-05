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
    case 'advance':
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
