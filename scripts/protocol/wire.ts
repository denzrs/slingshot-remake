import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the wire protocol is made of, as a fingerprint. The version number of the protocol (`PROTOCOL_VERSION`, see
 * `src/net/net.ts`) says when an older client has to be turned away, and nobody should have to remember to raise it: a test
 * (`tests/protocol-wire.test.ts`) fails whenever the fingerprint of the sources below differs from the one recorded in
 * `server/protocol-contract.json`, and `npm run protocol` records the new one (and raises the version, unless told the change is
 * compatible). The fingerprint is of what a client and the relay have to agree on, not of what either does with it:
 * the declarations of the messages, the state patches and their events, the rules, the contract's own tables.
 */

/** Files whose whole content, comments and spacing aside, is part of the wire. */
export const WIRE_FILES = [
  'src/net/net.ts',
  'src/net/netsync.ts',
  'src/net/messagepack.ts',
  'src/data/roomRules.ts',
  'src/data/roomLook.ts',
  'src/platform/avatars.ts',
  'src/game/roundReport.ts',
  'src/game/replay.ts',
] as const;

/** Declarations picked out of files that are mostly something else: the file, and what the declaration starts with. */
export const WIRE_DECLARATIONS = [{ file: 'src/game/match.ts', start: 'export type GameEvent =' }] as const;

const CONTRACT = 'server/protocol-contract.json';
const CLIENT_VERSION_FILE = 'src/net/net.ts';
const RELAY_VERSION_FILE = 'server/src/protocol.rs';

/** The text without comments and with its spacing collapsed, so that neither changes the fingerprint. */
export function normalize(source: string): string {
  return source
    // The number itself is not part of what it is the number of.
    .replace(/(PROTOCOL_VERSION(?::\s*u32)?\s*=\s*)\d+/g, '$1N')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The declaration that starts with `start`, up to the semicolon that ends it (one inside braces, brackets or parentheses does not). */
export function declaration(source: string, start: string): string {
  const from = source.indexOf(start);
  if (from < 0) throw new Error(`No "${start}" to fingerprint.`);
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ';' && depth === 0) return source.slice(from, i + 1);
  }
  throw new Error(`"${start}" does not end.`);
}

interface Contract {
  protocolVersion: number;
  wireFingerprint: string;
  [key: string]: unknown;
}

export function readContract(root: string): Contract {
  return JSON.parse(readFileSync(join(root, CONTRACT), 'utf8')) as Contract;
}

/** The fingerprint of the wire as the sources at `root` describe it. */
export function wireFingerprint(root: string): string {
  const hash = createHash('sha256');
  for (const file of WIRE_FILES) hash.update(`${file}\n${normalize(readFileSync(join(root, file), 'utf8'))}\n`);
  for (const { file, start } of WIRE_DECLARATIONS) hash.update(`${file}\n${normalize(declaration(readFileSync(join(root, file), 'utf8'), start))}\n`);
  // The contract's own tables (the rules and their options, the symbols, the CPU levels): everything but the two fields that
  // are about the contract itself.
  const { protocolVersion: _version, wireFingerprint: _fingerprint, ...tables } = readContract(root);
  hash.update(`${CONTRACT}\n${JSON.stringify(tables)}\n`);
  return hash.digest('hex').slice(0, 16);
}

/**
 * Records the wire as it is now. With `bump` the protocol version goes up by one everywhere it is written (the contract, the client,
 * the relay): what older clients can no longer live with. Without it only the fingerprint is recorded: a change they can.
 */
export function record(root: string, bump: boolean): { version: number; fingerprint: string } {
  const contract = readContract(root);
  const version = contract.protocolVersion + (bump ? 1 : 0);
  if (bump) {
    for (const [file, pattern] of [
      [CLIENT_VERSION_FILE, /(export const PROTOCOL_VERSION = )\d+/],
      [RELAY_VERSION_FILE, /(pub const PROTOCOL_VERSION: u32 = )\d+/],
    ] as const) {
      const path = join(root, file);
      const source = readFileSync(path, 'utf8');
      if (!pattern.test(source)) throw new Error(`No PROTOCOL_VERSION to raise in ${file}.`);
      writeFileSync(path, source.replace(pattern, `$1${version}`));
    }
  }
  // Written as text, not re-serialised, so the contract's own layout stays as it is.
  const path = join(root, CONTRACT);
  let text = readFileSync(path, 'utf8').replace(/("protocolVersion": )\d+/, `$1${version}`);
  const fingerprint = wireFingerprint(root);
  text = /"wireFingerprint"/.test(text)
    ? text.replace(/("wireFingerprint": ")[0-9a-f]*(")/, `$1${fingerprint}$2`)
    : text.replace(/("protocolVersion": \d+,)/, `$1\n  "wireFingerprint": "${fingerprint}",`);
  writeFileSync(path, text);
  return { version, fingerprint };
}
