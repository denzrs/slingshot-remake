import { POWER_UP_KINDS } from './powerups';
import { Packr, Unpackr } from 'msgpackr';

// Records are a msgpackr extension, not plain MessagePack, and rmp-serde cannot decode them.
const encoder = new Packr({ useRecords: false });
const decoder = new Unpackr({ useRecords: false });

const STATE_MAGIC = new Uint8Array([0x53, 0x4c, 0x4e, 0x47]); // SLNG
const STATE_VERSION = 1;
const STATE_KIND = 1;
const STATE_HEADER_BYTES = 14;

export const STATE_ENVELOPE_HEADER_BYTES = STATE_HEADER_BYTES;

/** Match JSON.stringify's omission of optional object fields, recursively. */
export function normalizeMessagePackValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => item === undefined ? null : normalizeMessagePackValue(item));
  }
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, normalizeMessagePackValue(item)]),
    );
  }
  return value;
}

/** MessagePack helpers restricted to standard maps/arrays for Rust interoperability. */
export function packMessage(value: unknown): Uint8Array {
  return encoder.pack(normalizeMessagePackValue(value));
}

export function unpackMessage(bytes: Uint8Array): unknown {
  return decoder.unpack(bytes);
}

/** Encode state updates with a readable fixed header and opaque MessagePack payload. */
export function packWireMessage(value: unknown): Uint8Array {
  if (!value || typeof value !== 'object' || (value as { type?: unknown }).type !== 'state') {
    return packMessage(value);
  }
  const message = value as { seq?: unknown; patch?: unknown; events?: unknown };
  validateStateMessage(message);
  const payload = packMessage({ patch: message.patch, events: message.events });
  const bytes = new Uint8Array(STATE_HEADER_BYTES + payload.byteLength);
  bytes.set(STATE_MAGIC, 0);
  bytes[4] = STATE_VERSION;
  bytes[5] = STATE_KIND;
  new DataView(bytes.buffer).setBigUint64(6, BigInt(message.seq as number), false);
  bytes.set(payload, STATE_HEADER_BYTES);
  return bytes;
}

/** Decode standard MessagePack messages or state envelopes from the relay. */
export function unpackWireMessage(bytes: Uint8Array): unknown {
  if (!isStateEnvelope(bytes)) {
    const value = unpackMessage(bytes);
    if (value && typeof value === 'object' && !Array.isArray(value) && (value as { type?: unknown }).type === 'state') {
      throw new Error('State messages require a versioned envelope');
    }
    return value;
  }
  if (bytes.byteLength < STATE_HEADER_BYTES || bytes[4] !== STATE_VERSION || bytes[5] !== STATE_KIND) {
    throw new Error('Invalid state envelope header');
  }
  const { seq, payload: payloadBytes } = readStateEnvelope(bytes);
  const payload = unpackMessage(payloadBytes);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid state envelope payload');
  }
  const state = { ...(payload as { patch?: unknown; events?: unknown }), type: 'state', seq };
  validateStateMessage(state);
  return state;
}

/** Read a state sequence and the opaque payload slice without decoding the payload. */
export function readStateEnvelope(bytes: Uint8Array): { seq: number; payload: Uint8Array } {
  if (!isStateEnvelope(bytes)) throw new Error('Invalid state envelope magic');
  if (bytes.byteLength <= STATE_HEADER_BYTES || bytes[4] !== STATE_VERSION || bytes[5] !== STATE_KIND) {
    throw new Error('Invalid state envelope header');
  }
  const seq = Number(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(6, false));
  if (!Number.isSafeInteger(seq)) throw new Error('Invalid state sequence');
  return { seq, payload: bytes.subarray(STATE_HEADER_BYTES) };
}

function validateStateMessage(message: { seq?: unknown; patch?: unknown; events?: unknown }): void {
  if (!Number.isSafeInteger(message.seq) || (message.seq as number) < 0) {
    throw new Error('Invalid state sequence');
  }
  if (!message.patch || typeof message.patch !== 'object' || Array.isArray(message.patch)) {
    throw new Error('Invalid state patch');
  }
  if (!Array.isArray(message.events) || !message.events.every(isGameEvent)) throw new Error('Invalid state events');
}

function isGameEvent(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const finite = (key: string) => typeof event[key] === 'number' && Number.isFinite(event[key]);
  const index = (key: string) => Number.isSafeInteger(event[key]) && (event[key] as number) >= 0;
  const kindOf = (kind: unknown): boolean => typeof kind === 'string' && (POWER_UP_KINDS as readonly string[]).includes(kind);
  const record = (candidate: unknown): candidate is Record<string, unknown> =>
    !!candidate && typeof candidate === 'object' && !Array.isArray(candidate);
  switch (event.type) {
    case 'round': case 'gameOver': case 'roundEnd': case 'volley': case 'collapse':
      return true;
    case 'killcam':
      return typeof event.active === 'boolean' && typeof event.recording === 'boolean';
    case 'turn': case 'lock':
      return index('player');
    case 'fire':
      return index('player') && finite('x') && finite('y') && finite('angle') && finite('power');
    case 'impact':
      return index('player') && finite('x') && finite('y') && finite('vx') && finite('vy');
    case 'explode':
      return index('ship') && finite('x') && finite('y') && finite('vx') && finite('vy');
    case 'fizzle':
      return index('player') && finite('x') && finite('y') && finite('vx') && finite('vy') && typeof event.lost === 'boolean';
    case 'clash':
      return finite('x') && finite('y') && finite('points')
        && Array.isArray(event.players) && event.players.length === 2 && event.players.every((id) => Number.isSafeInteger(id) && (id as number) >= 0)
        && Array.isArray(event.velocities) && event.velocities.length === 2
        && event.velocities.every((velocity) => record(velocity) && typeof velocity.x === 'number' && Number.isFinite(velocity.x)
          && typeof velocity.y === 'number' && Number.isFinite(velocity.y));
    case 'devour':
      return finite('x') && finite('y') && finite('toX') && finite('toY') && typeof event.color === 'string'
        && finite('vx') && finite('vy');
    case 'style':
      return index('player') && ['swingby', 'bank', 'graze', 'photon', 'airtime'].includes(String(event.kind))
        && finite('x') && finite('y');
    case 'kill': {
      const kill = event.record;
      return record(kill) && (kill.killer === null || (Number.isSafeInteger(kill.killer) && (kill.killer as number) >= 0))
        && Number.isSafeInteger(kill.victim) && (kill.victim as number) >= 0
        && typeof kill.points === 'number' && Number.isFinite(kill.points)
        && typeof kill.self === 'boolean' && typeof kill.friendly === 'boolean'
        && Array.isArray(kill.combo) && kill.combo.every((kind) => ['swingby', 'bank', 'graze', 'photon', 'airtime'].includes(String(kind)))
        && typeof kill.multiplier === 'number' && Number.isFinite(kill.multiplier)
        && Number.isSafeInteger(kill.shots) && typeof kill.power === 'number' && Number.isFinite(kill.power)
        && typeof kill.at === 'number' && Number.isFinite(kill.at);
    }
    case 'pickup':
      return index('player') && kindOf(event.kind) && (event.dropped === null || kindOf(event.dropped)) && finite('x') && finite('y');
    case 'pickupSpawn': case 'pickupFade':
      return kindOf(event.kind) && finite('x') && finite('y');
    case 'teleport':
      return index('player') && finite('fromX') && finite('fromY') && finite('toX') && finite('toY');
    case 'blackhole':
      return index('player') && finite('x') && finite('y');
    case 'planetKiller':
      return index('player') && finite('x') && finite('y') && finite('radius');
    case 'wormhole':
      return index('player') && finite('x') && finite('y') && finite('toX') && finite('toY');
    case 'nebula':
      return index('player') && finite('x') && finite('y');
    case 'defense':
      return index('player') && finite('x') && finite('y');
    case 'shotdown':
      return index('player') && finite('x') && finite('y') && finite('vx') && finite('vy');
    case 'multiKill':
      return index('player') && finite('kills') && finite('points') && finite('x') && finite('y');
    case 'split':
      return index('player') && finite('x') && finite('y');
    case 'shield':
      return index('ship') && finite('x') && finite('y');
    default:
      return false;
  }
}

function isStateEnvelope(bytes: Uint8Array): boolean {
  return bytes.byteLength >= STATE_MAGIC.length
    && bytes[0] === STATE_MAGIC[0]
    && bytes[1] === STATE_MAGIC[1]
    && bytes[2] === STATE_MAGIC[2]
    && bytes[3] === STATE_MAGIC[3];
}
