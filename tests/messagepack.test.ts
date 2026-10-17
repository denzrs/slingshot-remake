import { describe, expect, it } from 'vitest';
import { packMessage, packWireMessage, readStateEnvelope, unpackWireMessage } from '../src/messagepack';

describe('state wire envelope', () => {
  it('keeps sequence in the header and preserves the MessagePack payload bytes', () => {
    const state = { type: 'state', seq: 0x010203040506, patch: { t: 7, board: [1, 2] }, events: [] };
    const frame = packWireMessage(state);
    const payload = packMessage({ patch: state.patch, events: state.events });

    expect(Array.from(frame.subarray(0, 14))).toEqual([
      0x53, 0x4c, 0x4e, 0x47, 1, 1, 0, 0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(Array.from(frame.subarray(14))).toEqual(Array.from(payload));
    expect(unpackWireMessage(frame)).toEqual(state);
  });

  it('continues to accept legacy MessagePack control messages', () => {
    const message = { type: 'state', seq: 3, patch: {}, events: [] };
    expect(unpackWireMessage(packWireMessage({ type: 'lobby' }))).toEqual({ type: 'lobby' });
    expect(unpackWireMessage(packMessage({ type: 'lobby' }))).toEqual({ type: 'lobby' });
    expect(() => unpackWireMessage(packMessage(message))).toThrow('State messages require a versioned envelope');
  });

  it('rejects an unsupported envelope version', () => {
    const frame = packWireMessage({ type: 'state', seq: 1, patch: {}, events: [] });
    frame[4] = 2;
    expect(() => unpackWireMessage(frame)).toThrow('Invalid state envelope header');
  });

  it('can inspect the envelope sequence while preserving invalid payload bytes opaquely', () => {
    const frame = packWireMessage({ type: 'state', seq: 19, patch: {}, events: [] });
    const payload = new Uint8Array([0xc1]);
    const malformedPayloadFrame = new Uint8Array(14 + payload.byteLength);
    malformedPayloadFrame.set(frame.subarray(0, 14));
    malformedPayloadFrame.set(payload, 14);

    const envelope = readStateEnvelope(malformedPayloadFrame);
    expect(envelope.seq).toBe(19);
    expect(Array.from(envelope.payload)).toEqual([0xc1]);
    expect(() => unpackWireMessage(malformedPayloadFrame)).toThrow();
  });

  it('rejects missing state fields and invalid sequence numbers on both wire forms', () => {
    expect(() => packWireMessage({ type: 'state', seq: -1, patch: {}, events: [] })).toThrow('Invalid state sequence');
    const invalidSeq = packWireMessage({ type: 'state', seq: 1, patch: {}, events: [] });
    new DataView(invalidSeq.buffer).setBigUint64(6, BigInt(Number.MAX_SAFE_INTEGER) + 1n, false);
    expect(() => unpackWireMessage(invalidSeq)).toThrow('Invalid state sequence');
    expect(() => packWireMessage({ type: 'state', seq: 1, patch: [], events: [] })).toThrow('Invalid state patch');
    expect(() => packWireMessage({ type: 'state', seq: 1, patch: {}, events: {} })).toThrow('Invalid state events');
  });

  it('rejects malformed game events in state frames', () => {
    expect(() => packWireMessage({
      type: 'state', seq: 1, patch: {}, events: [{ type: 'turn', player: -1 }],
    })).toThrow('Invalid state events');
    const malformedPayload = packMessage({ patch: {}, events: [{ type: 'unknown' }] });
    const frame = new Uint8Array(14 + malformedPayload.length);
    frame.set([0x53, 0x4c, 0x4e, 0x47, 1, 1]);
    new DataView(frame.buffer).setBigUint64(6, 1n, false);
    frame.set(malformedPayload, 14);
    expect(() => unpackWireMessage(frame)).toThrow('Invalid state events');
  });

  it('rejects malformed and non-map envelope payloads', () => {
    const malformed = new Uint8Array([0x53, 0x4c, 0x4e, 0x47, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0xc1]);
    expect(() => unpackWireMessage(malformed)).toThrow();

    const scalar = packMessage(1);
    const frame = new Uint8Array(14 + scalar.byteLength);
    frame.set([0x53, 0x4c, 0x4e, 0x47, 1, 1]);
    frame.set(scalar, 14);
    expect(() => unpackWireMessage(frame)).toThrow('Invalid state envelope payload');
  });

});
