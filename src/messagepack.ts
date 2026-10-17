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
      const message = value as { type: string; seq?: unknown; patch?: unknown; events?: unknown };
      validateStateMessage(message);
      return message;
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
  if (!Array.isArray(message.events)) throw new Error('Invalid state events');
}

function isStateEnvelope(bytes: Uint8Array): boolean {
  return bytes.byteLength >= STATE_MAGIC.length
    && bytes[0] === STATE_MAGIC[0]
    && bytes[1] === STATE_MAGIC[1]
    && bytes[2] === STATE_MAGIC[2]
    && bytes[3] === STATE_MAGIC[3];
}
