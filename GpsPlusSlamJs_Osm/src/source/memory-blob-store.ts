/**
 * In-memory `OsmBlobStore`, for tests and for consumers that do not want
 * persistence.
 *
 * @see memory-blob-store.ts.md
 */

import type { OsmBlobStore } from "./osm-blob-store.js";

export class MemoryBlobStore implements OsmBlobStore {
  private readonly entries = new Map<string, string>();

  /** Counts every operation, so tests can assert cache behaviour precisely. */
  readonly stats = { gets: 0, puts: 0, deletes: 0 };

  get(key: string): Promise<string | undefined> {
    this.stats.gets++;
    return Promise.resolve(this.entries.get(key));
  }

  put(key: string, value: string): Promise<void> {
    this.stats.puts++;
    this.entries.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.stats.deletes++;
    this.entries.delete(key);
    return Promise.resolve();
  }

  keys(): Promise<readonly string[]> {
    return Promise.resolve([...this.entries.keys()]);
  }

  /** Test helper: total entries held. Not part of `OsmBlobStore`. */
  get size(): number {
    return this.entries.size;
  }
}
