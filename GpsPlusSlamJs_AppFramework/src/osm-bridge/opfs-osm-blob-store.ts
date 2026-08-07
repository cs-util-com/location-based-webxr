/**
 * OPFS-backed persistence for the OSM package's injected blob store.
 *
 * WHY THIS LIVES IN THE FRAMEWORK AND NOT IN `gps-plus-slam-osm`. That package
 * is pure data by design (its plan §4.2): persistence is *injected* precisely so
 * it runs unchanged in Node, in a Worker, and in the Investigation harness, none
 * of which have OPFS. The framework is where browser APIs are allowed to appear,
 * so the adapter belongs here.
 *
 * WHY IT TAKES NO DEPENDENCY ON `gps-plus-slam-osm` AT ALL, and this turned out
 * to be load-bearing rather than fastidious: the framework is **published to
 * npm** and `gps-plus-slam-osm` is **not**, so a dependency on it — even an
 * optional peer — makes `pnpm install` fail with a registry 404 for every
 * consumer. Declaring `OsmBlobStore` structurally instead means this module
 * compiles, ships and installs standing alone, and starts working the moment
 * something passes it to `CachingSource`.
 *
 * The consequence for the rest of the bridge: anything needing the OSM
 * package's RUNTIME exports (the index/score worker) cannot live here until
 * that package is published. It lives in the consumer app for now, which is
 * also where this repo puts worker shells anyway.
 *
 * WHY KEYS ARE ESCAPED RATHER THAN NESTED. The OSM package's keys look like
 * `osm/v2/871fa199affffff` and `rules/v1/table.csv` — they contain slashes, and
 * they come from a library that is free to change their shape. Creating nested
 * directories from a caller-supplied string is how a `..` segment becomes a
 * traversal, and it makes `keys()` a recursive walk for no benefit. So each key
 * is `encodeURIComponent`-escaped into a single flat filename: reversible,
 * traversal-proof, and `keys()` is one directory listing.
 *
 * @see opfs-osm-blob-store.ts.md
 */

import { createLogger } from '../utils/logger';
import { writeFileOrAbort } from '../storage/write-file-or-abort';

const log = createLogger('OsmBlobStore');

/**
 * The shape `gps-plus-slam-osm` asks for.
 *
 * Declared structurally rather than imported, and that is not fastidiousness:
 * the framework is published to npm while `gps-plus-slam-osm` is not, so ANY
 * dependency on it — including a type-only import, which still lands in the
 * published type declarations — makes `pnpm install` 404 for every consumer.
 * The interface is four methods and stable.
 */
export interface OsmBlobStore {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
}

/** The subdirectory of the app's OPFS root that OSM data lives in. */
export const OSM_STORE_DIR = 'osm';

export interface OpfsOsmBlobStoreOptions {
  /**
   * Directory to store in.
   *
   * Injected rather than resolved internally so the tests can supply a fake and
   * so a consumer can put OSM data somewhere other than the app root — an app
   * that wants OSM tiles evictable separately from recordings, say.
   */
  readonly directory: FileSystemDirectoryHandle;
}

/**
 * Persists OSM tiles and rule tables in OPFS.
 *
 * Every method degrades rather than throwing on a missing entry, matching the
 * `CachingSource` contract that a corrupt or absent entry is a cache MISS, not
 * an error — the whole point of a cache-first design is that storage problems
 * cost a network request rather than a session.
 */
export class OpfsOsmBlobStore implements OsmBlobStore {
  private readonly directory: FileSystemDirectoryHandle;

  readonly stats = { gets: 0, hits: 0, puts: 0, deletes: 0, errors: 0 };

  constructor(options: OpfsOsmBlobStoreOptions) {
    this.directory = options.directory;
  }

  async get(key: string): Promise<string | undefined> {
    this.stats.gets++;
    try {
      const handle = await this.directory.getFileHandle(fileNameFor(key));
      const file = await handle.getFile();
      this.stats.hits++;
      return await file.text();
    } catch {
      // NotFoundError is the common case and is not worth logging; anything
      // else (a quota read failure, a revoked handle) is still a miss, because
      // a cache that throws is worse than a cache that misses.
      return undefined;
    }
  }

  async put(key: string, value: string): Promise<void> {
    try {
      const handle = await this.directory.getFileHandle(fileNameFor(key), {
        create: true,
      });
      // NOT a hand-rolled createWritable/write/close: `close()` is what COMMITS
      // the temp file, so closing on the failure path swaps a TRUNCATED blob
      // over a previously good one — and `CachingSource` only rejects entries
      // that fail to parse, so that tile stays a permanent miss until something
      // evicts it. `writeFileOrAbort` discards the temp instead, and reports the
      // write error rather than whatever `close()` threw on top of it.
      await writeFileOrAbort(handle, value);
      this.stats.puts++;
    } catch (error) {
      // A failed write must not fail the fetch that triggered it. The tile is
      // already in hand; losing the cache entry costs one future request.
      this.stats.errors++;
      log.warn('Could not persist OSM blob; continuing without caching it', {
        key,
        error,
      });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.directory.removeEntry(fileNameFor(key));
      this.stats.deletes++;
    } catch {
      // Deleting something that is not there is success, not failure.
    }
  }

  async keys(): Promise<readonly string[]> {
    const out: string[] = [];
    try {
      for await (const name of this.directory.keys()) {
        const key = keyForFileName(name);
        if (key !== undefined) out.push(key);
      }
    } catch (error) {
      this.stats.errors++;
      log.warn('Could not list OSM blobs', { error });
    }
    return out;
  }
}

/**
 * Escapes a store key into a flat filename.
 *
 * `encodeURIComponent` escapes `/`, `.` runs are harmless once slashes are gone,
 * and the result is reversible — which `keys()` depends on, because the OSM
 * package's `listCachedTiles()` filters the keys it gets back by prefix.
 */
export function fileNameFor(key: string): string {
  return `${encodeURIComponent(key)}.blob`;
}

/** Inverse of {@link fileNameFor}; `undefined` for anything we did not write. */
export function keyForFileName(name: string): string | undefined {
  if (!name.endsWith('.blob')) return undefined;
  try {
    return decodeURIComponent(name.slice(0, -'.blob'.length));
  } catch {
    // A malformed percent-escape means the file was not written by us. Ignoring
    // it is safer than surfacing a key that no `get` could ever resolve.
    return undefined;
  }
}

/**
 * Opens (creating if needed) the OSM subdirectory of an OPFS root.
 *
 * Separate from the class so the store itself needs no async construction —
 * a constructor that cannot fail is easier to use from a driver that may be
 * built before storage is ready.
 */
export async function openOsmStoreDirectory(
  root: FileSystemDirectoryHandle,
  name: string = OSM_STORE_DIR
): Promise<FileSystemDirectoryHandle> {
  return root.getDirectoryHandle(name, { create: true });
}
