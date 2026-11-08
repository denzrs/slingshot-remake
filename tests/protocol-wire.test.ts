import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/net/net';
import { declaration, normalize, readContract, record, WIRE_DECLARATIONS, WIRE_FILES, wireFingerprint } from '../scripts/protocol/wire';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('the wire protocol', () => {
  it('has its current fingerprint recorded, or says what to run when it changed', () => {
    const recorded = readContract(root).wireFingerprint;
    expect(
      wireFingerprint(root),
      [
        'The wire protocol changed since it was last recorded (the messages, the state patches and their events, the rules, or the contract tables).',
        'Run `npm run protocol` if an older client cannot live with the change: it raises PROTOCOL_VERSION on both sides, so the relay turns such a client away and tells it to reload.',
        'Run `npm run protocol -- --compatible` if older clients do survive it. When in doubt, the first: an old client is only asked to reload.',
      ].join('\n'),
    ).toBe(recorded);
  });

  it('names the same version in the contract and in the client', () => {
    expect(readContract(root).protocolVersion).toBe(PROTOCOL_VERSION);
  });
});

describe('the fingerprint', () => {
  it('does not notice comments, spacing or the version number itself', () => {
    const a = 'export const PROTOCOL_VERSION = 1; // one\ntype A = { x: number }; /* more */';
    const b = 'export const PROTOCOL_VERSION = 7;\n\ntype A = {\n  x: number\n};';
    expect(normalize(a)).toBe(normalize(b));
    expect(normalize('pub const PROTOCOL_VERSION: u32 = 3;')).toBe(normalize('pub const PROTOCOL_VERSION: u32 = 4;'));
  });

  it('does notice a change to what is declared', () => {
    expect(normalize('type A = { x: number };')).not.toBe(normalize('type A = { x: string };'));
  });

  it('keeps a slash pair inside a string', () => {
    expect(normalize("const url = 'ws://relay'; // the relay")).toBe("const url = 'ws://relay';");
  });

  it('takes a declaration up to the semicolon that ends it, not one inside it', () => {
    const source = "export type E =\n  | { type: 'a'; n: number }\n  | { type: 'b' };\nconst next = 1;";
    expect(declaration(source, 'export type E =')).toBe("export type E =\n  | { type: 'a'; n: number }\n  | { type: 'b' };");
    expect(() => declaration(source, 'export type Missing =')).toThrow();
  });

  it('is made of files and declarations that exist', () => {
    for (const file of WIRE_FILES) expect(() => readFileSync(join(root, file), 'utf8'), file).not.toThrow();
    for (const { file, start } of WIRE_DECLARATIONS) expect(() => declaration(readFileSync(join(root, file), 'utf8'), start), start).not.toThrow();
  });
});

describe('recording the wire', () => {
  /** A copy of the files the fingerprint and the version live in, to record in without touching the real ones. */
  function copy(): string {
    const dir = mkdtempSync(join(tmpdir(), 'slingshot-wire-'));
    const files = [...WIRE_FILES, ...WIRE_DECLARATIONS.map(({ file }) => file), 'server/protocol-contract.json', 'server/src/protocol.rs'];
    for (const file of files) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      cpSync(join(root, file), join(dir, file));
    }
    return dir;
  }

  it('raises the version everywhere it is written, and keeps the fingerprint of the same wire', () => {
    const dir = copy();
    try {
      const before = wireFingerprint(dir);
      const { version, fingerprint } = record(dir, true);
      expect(version).toBe(PROTOCOL_VERSION + 1);
      expect(fingerprint).toBe(before);
      expect(readContract(dir).protocolVersion).toBe(PROTOCOL_VERSION + 1);
      expect(readFileSync(join(dir, 'src/net/net.ts'), 'utf8')).toContain(`export const PROTOCOL_VERSION = ${PROTOCOL_VERSION + 1};`);
      expect(readFileSync(join(dir, 'server/src/protocol.rs'), 'utf8')).toContain(`pub const PROTOCOL_VERSION: u32 = ${PROTOCOL_VERSION + 1};`);
      expect(wireFingerprint(dir)).toBe(readContract(dir).wireFingerprint);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records a changed wire with or without raising the version', () => {
    for (const bump of [true, false]) {
      const dir = copy();
      try {
        const file = join(dir, 'src/net/net.ts');
        writeFileSync(file, `${readFileSync(file, 'utf8')}\nexport type Added = { kind: 'new' };\n`);
        const changed = wireFingerprint(dir);
        expect(changed).not.toBe(readContract(dir).wireFingerprint);
        const { version } = record(dir, bump);
        expect(version).toBe(PROTOCOL_VERSION + (bump ? 1 : 0));
        expect(readContract(dir).wireFingerprint).toBe(changed);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
