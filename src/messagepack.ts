import { Packr, Unpackr } from 'msgpackr';

// Records are a msgpackr extension, not plain MessagePack, and rmp-serde cannot decode them.
const encoder = new Packr({ useRecords: false });
const decoder = new Unpackr({ useRecords: false });

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
