/**
 * One background tile at a time, dropped the moment the user leaves (W8).
 *
 * WHY THIS EXISTS. Crossing a res-7 fetch-tile boundary costs an ~20 s
 * Overpass request for ~21 MB, and nothing tells the user which click will pay
 * it — which is most of what the round-3 notes called "undeterministisch". The
 * answer, decided in round 2 as DEC-R2-6 and carried here as W8, is to pull the
 * six neighbouring tiles in the background so the boundary crossing is already
 * paid for.
 *
 * **The cost is accepted with the number stated: 170–400 MB per move against
 * donated Overpass infrastructure.** Throttling spreads that total over time; it
 * does not reduce it. That is why every discipline below is load-bearing rather
 * than tidy:
 *
 * - **One request in flight, ever.** The public instances allocate ~2 slots per
 *   client and the user's own fetch needs one of them.
 * - **The user's fetch is never queued behind a prefetch.** `replace` is called
 *   after the visible work, and a prefetch that is running when the user moves is
 *   ABORTED rather than awaited.
 * - **Abandoned areas are dropped, not finished.** `replace` states the whole
 *   desired set; anything not in it is discarded, including the in-flight tile.
 * - **Nothing is requested twice.** Already-loaded tiles are skipped, and a tile
 *   that is queued or in flight is not queued again.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: hand the result to the index. A prefetched
 * tile is written to the OPFS blob store by `CachingSource` and stops there, so
 * the next click parses it from disk in seconds instead of fetching it in
 * minutes — while the in-memory feature set stays limited to ground the user has
 * actually reached. Merging every prefetched tile would multiply the worker's
 * memory by seven for data that may never be looked at.
 *
 * @see prefetch-queue.ts.md
 */

/** How many tiles may wait behind the one in flight. */
const MAX_PENDING = 6;

export interface PrefetchQueueOptions {
  /** Fetches one tile. The signal is honoured all the way to `fetch`. */
  readonly fetchTile: (tile: string, signal: AbortSignal) => Promise<unknown>;
  /** Tiles the index already holds are not worth requesting. */
  readonly isLoaded?: (tile: string) => boolean;
  /** Called after each tile settles — `ok: false` for a failure or an abort. */
  readonly onSettled?: (tile: string, ok: boolean) => void;
}

export interface PrefetchQueue {
  /**
   * States the whole set of tiles worth having in the background.
   *
   * REPLACES rather than appends, which is what makes "dropped for areas the
   * user has left" structural: the caller says what it wants now, and everything
   * else — queued or in flight — is abandoned.
   */
  replace(tiles: readonly string[]): void;
  /** Abandons everything. For teardown. */
  stop(): void;
  /** The tile currently being fetched, for tests and for the status line. */
  readonly inFlight: string | undefined;
  /** How many tiles are waiting. */
  readonly pending: number;
}

export function createPrefetchQueue(
  options: PrefetchQueueOptions,
): PrefetchQueue {
  const { fetchTile, isLoaded, onSettled } = options;

  let queue: string[] = [];
  let active: { tile: string; controller: AbortController } | undefined;

  function start(): void {
    if (active !== undefined) return;
    const tile = queue.shift();
    if (tile === undefined) return;

    const controller = new AbortController();
    active = { tile, controller };
    void fetchTile(tile, controller.signal)
      .then(
        () => {
          onSettled?.(tile, !controller.signal.aborted);
        },
        () => {
          // A failed prefetch is not an error the user should ever see: nothing
          // was promised and the next click will fetch it in the foreground.
          onSettled?.(tile, false);
        },
      )
      .finally(() => {
        active = undefined;
        start();
      });
  }

  return {
    replace(tiles: readonly string[]): void {
      const wanted = new Set(tiles.filter((tile) => isLoaded?.(tile) !== true));

      // ABORT THE IN-FLIGHT ONE IF IT IS NO LONGER WANTED. This is the half of
      // DEC-R2-6 that has to genuinely work rather than be nominal — a ~21 MB
      // request for ground the user has left is exactly the waste the whole
      // discipline exists to avoid. `finally` above will start the next one.
      if (active !== undefined && !wanted.has(active.tile)) {
        active.controller.abort();
      }
      // Whatever is in flight is not also queued: it is already being had.
      if (active !== undefined) wanted.delete(active.tile);

      queue = [...wanted].slice(0, MAX_PENDING);
      start();
    },

    stop(): void {
      queue = [];
      active?.controller.abort();
    },

    get inFlight(): string | undefined {
      return active?.tile;
    },

    get pending(): number {
      return queue.length;
    },
  };
}
