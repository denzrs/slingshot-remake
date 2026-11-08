import { createHash } from 'node:crypto';

/** What the build's file list turns into: the worker's source and the name of the cache it fills. */
export interface BuiltWorker {
  cache: string;
  source: string;
}

/**
 * Fills the service worker template (`scripts/pwa/sw.js`) for one build. `files` maps each file of the build, as a path
 * relative to its root (`index.html`, `assets/index-Ab12.js`, ...), to its content; the worker itself is not one of them. The
 * cache is named after the paths and the content: a hashed asset name already changes with its content, but `index.html`, the
 * manifest and the icons keep their names, and a cache that kept its name would keep serving them as they were.
 */
export function buildWorker(template: string, files: Readonly<Record<string, string | Uint8Array>>): BuiltWorker {
  const list = Object.keys(files).filter((file) => file !== 'sw.js').sort();
  if (!list.length) throw new Error('The service worker has nothing to cache.');
  const bad = list.find((file) => file.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(file));
  if (bad) throw new Error(`The service worker caches paths relative to its scope, not "${bad}".`);
  const hash = createHash('sha256');
  for (const file of list) hash.update(file).update('\0').update(files[file]).update('\0');
  const cache = `slingshot-${hash.digest('hex').slice(0, 12)}`;
  return {
    cache,
    source: template.replace('__CACHE__', () => cache).replace('__FILES__', () => JSON.stringify(list, null, 2)),
  };
}
