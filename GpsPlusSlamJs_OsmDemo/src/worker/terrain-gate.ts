/**
 * "Do not build the mesh until the terrain under THIS position has landed."
 *
 * WHY THIS EXISTS (W3, finding R3-3). The refresh used to be chained behind the
 * terrain load on the main thread — `loadTerrain(p).finally(() => refresh())` —
 * so an entire ~55 000-post DEM grid was sampled, transferred and applied before
 * the fetch and the scoring even started. Running them concurrently is worth
 * seconds per click, and it is only safe if something still guarantees that the
 * mesh is built on the terrain of the position it belongs to. Without that the
 * buildings stand on the PREVIOUS position's relief and nothing ever rebuilds
 * them — the half-swapped scene this demo has twice engineered away.
 *
 * WHY IT IS KEYED ON THE POSITION AND NOT ON MESSAGE ORDER (DEC-R3-20). The
 * first design said: `postMessage` delivery is ordered and the worker's listener
 * runs each handler synchronously, so posting `terrain` before `update`
 * guarantees the terrain is registered first. Both premises are true and the
 * conclusion is still false, because **`loadTerrain` does not always post when
 * it is called**: it is `latestOnly`-wrapped, so while a load is in flight a new
 * position only queues, and the post happens a microtask later. With the terrain
 * cycle busy and the refresh cycle idle — a slow DEM tile behind a fully cached
 * refresh, which is ordinary — the `update` is posted first and finds nothing
 * registered. Keying on the position makes the order irrelevant: the waiter
 * names the centre it needs and waits for that centre whenever it arrives.
 *
 * WHY THE WAIT IS BOUNDED TWICE. "Wait for a message that may never be posted"
 * is the failure mode this shape invites, and a hung worker is worse than a
 * stale field. It ends on the caller's own `AbortSignal` — a superseded click
 * aborts its update anyway — and on a timeout, after which the mesh is built on
 * whatever field is held. Degraded, never hung.
 *
 * @see terrain-gate.ts.md
 */

/**
 * How long a mesh build waits for its terrain before giving up, milliseconds.
 *
 * A backstop, not a schedule. Every ordinary path settles the gate — the terrain
 * handler settles in a `finally`, so even a DEM outage releases waiters — so
 * reaching this means a load was dropped in a way nothing modelled. Long enough
 * to cover a real DEM fetch (tiles are ~21 MB of OSM's neighbour, but a
 * Terrarium tile is small and slow only on a cold network), short enough that a
 * user is not looking at a frozen scene.
 *
 * NOT EXPORTED: nothing outside this module has any business branching on it,
 * and an export nobody imports is dead surface the dead-code gate is right to
 * reject. Callers that need a different bound pass `timeoutMs`.
 */
const TERRAIN_WAIT_TIMEOUT_MS = 15_000;

/** A position, structurally — this module never looks at anything else. */
export interface GateCentre {
  readonly lat: number;
  readonly lng: number;
}

export interface TerrainGate {
  /**
   * Releases everything waiting for `centre`, and remembers that it landed.
   *
   * Call it in a `finally`: a terrain load that FAILED still answers the
   * question "is the terrain for this position resolved?", and a waiter that
   * blocks on a failed load would turn a DEM outage into a stalled mesh.
   */
  settle(centre: GateCentre): void;
  /**
   * Waits until `centre`'s terrain has settled, or the signal aborts, or the
   * timeout elapses. Resolves immediately when it has already settled.
   *
   * Never rejects — including on abort. The caller's own abort handling decides
   * what a superseded run does; this only decides how long to wait.
   */
  waitFor(centre: GateCentre, signal?: AbortSignal): Promise<void>;
}

export interface TerrainGateOptions {
  readonly timeoutMs?: number;
  /** Injected so a test does not have to spend real time. */
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/** `lat,lng` — exact, because both sides derive it from the same numbers. */
function keyOf(centre: GateCentre): string {
  return `${centre.lat},${centre.lng}`;
}

/**
 * Whether a mesh build at `position` must wait for terrain.
 *
 * `held` is the centre the worker's current field belongs to, or `undefined`
 * before any load. EXACT equality is right here for the same reason the key is:
 * both numbers come from the same store position, so they are the same doubles,
 * and a tolerance would be a way to accept the *previous* position's field on a
 * short step — which is precisely the stale surface this is guarding.
 *
 * Exported because it is the decision, and the decision is what can be wrong: a
 * predicate that answers "no wait" too eagerly rebuilds the bug silently, while
 * one that answers "wait" too eagerly stalls every category change on the gate's
 * full timeout.
 */
export function needsTerrainFor(
  held: GateCentre | undefined,
  position: GateCentre,
): boolean {
  if (held === undefined) return true;
  return held.lat !== position.lat || held.lng !== position.lng;
}

/**
 * Builds a gate.
 *
 * ONE SETTLED CENTRE IS REMEMBERED, not a set, and that is deliberate: the
 * question is only ever "is the CURRENT position's terrain resolved?", and a
 * growing set of every centre ever visited would be a leak whose entries are
 * never read. A new load for the same centre clears it, so a re-load is waited
 * for rather than answered from the previous one.
 */
export function createTerrainGate(
  options: TerrainGateOptions = {},
): TerrainGate {
  const timeoutMs = options.timeoutMs ?? TERRAIN_WAIT_TIMEOUT_MS;
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });

  const waiters = new Map<string, Set<() => void>>();
  let settledKey: string | undefined;

  return {
    settle(centre: GateCentre): void {
      const key = keyOf(centre);
      settledKey = key;
      const waiting = waiters.get(key);
      waiters.delete(key);
      for (const release of waiting ?? []) release();
    },

    waitFor(centre: GateCentre, signal?: AbortSignal): Promise<void> {
      const key = keyOf(centre);
      if (settledKey === key) return Promise.resolve();
      if (signal?.aborted === true) return Promise.resolve();

      return new Promise<void>((resolve) => {
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          clearTimer(timer);
          signal?.removeEventListener("abort", finish);
          waiters.get(key)?.delete(finish);
          resolve();
        };

        const timer = setTimer(finish, timeoutMs);
        signal?.addEventListener("abort", finish, { once: true });

        const waiting = waiters.get(key) ?? new Set<() => void>();
        waiting.add(finish);
        waiters.set(key, waiting);
      });
    },
  };
}
