/**
 * `npm run protocol` records the wire protocol as it is now and raises its version: what to do after a change to the messages, the
 * state patches or the rules that an older client cannot live with, so that the relay turns such a client away and tells it to reload.
 * `npm run protocol -- --compatible` records it without raising the version, for a change older clients do survive (a field they ignore,
 * a reordering, a type that only changed its name). When in doubt, raise it: an old client is only asked to reload.
 */
import { fileURLToPath } from 'node:url';
import { record } from './wire';

const root = fileURLToPath(new URL('../..', import.meta.url));
const compatible = process.argv.includes('--compatible');
const { version, fingerprint } = record(root, !compatible);
console.log(compatible ? `Recorded the wire (${fingerprint}); the protocol stays at version ${version}.` : `Recorded the wire (${fingerprint}) and raised the protocol to version ${version}.`);
