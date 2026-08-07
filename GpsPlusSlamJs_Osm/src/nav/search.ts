/**
 * Breadth-first search over an arbitrary state space.
 *
 * **Why this is not just "pathfinding over cells".** The first version of pass A
 * keyed its visited set by H3 cell, and review on #257 showed what that costs:
 * a cell could be entered at most once, so the wall-foot state and the wall-top
 * state could not both exist in one search — and the step predicate, seeing only
 * cell strings, had to resolve one height per cell. That is a 2D model with a
 * step filter, which is exactly what the column model exists to replace.
 *
 * So the state is whatever the caller says it is, and the caller supplies its
 * identity. `Column` is a state whose key includes a height; a bare cell is a
 * state whose key is itself. Nothing here knows which.
 *
 * **`candidates` and `canEnter` are separate on purpose.** Generating a
 * neighbour is cheap — grid adjacency — while deciding whether the step is legal
 * is not: pass B does point-in-polygon and a height lookup per call. Splitting
 * them lets the search drop an already-visited state BEFORE paying for the
 * decision, which in a flood is roughly five calls in six.
 *
 * @see search.ts.md
 */

/** How to enumerate and identify the states of a search. */
export interface StateSpace<S> {
  /**
   * Identity for visited-tracking: two states with the same key are the same
   * place, and the search enters each key once.
   *
   * This is where a column's height enters. Keys must be stable and total —
   * a key function that collides distinct states silently merges them, which
   * is the failure the cell-keyed version had by construction.
   */
  readonly key: (state: S) => string;
  /**
   * States reachable in one step, before legality is considered. Cheap.
   *
   * May include the state itself and may repeat; the search filters both.
   */
  readonly candidates: (state: S) => Iterable<S>;
  /**
   * Whether the step is actually allowed. Expensive, and called at most once
   * per newly discovered state.
   *
   * Omitted means every candidate is allowed.
   */
  readonly canEnter?: (from: S, to: S) => boolean;
}

export interface SearchOptions {
  /** Hard ceiling on states expanded before the search throws. */
  maxExpansions?: number;
}

/**
 * States a single search may expand before it throws.
 *
 * The demo's scored working set is ~10^3 cells at the shipped disk radius, and
 * a column space multiplies that by the number of standable levels per cell —
 * so this is still ample headroom while remaining low enough that an unbounded
 * space surfaces immediately rather than as a frozen tab.
 */
export const DEFAULT_MAX_EXPANSIONS = 100_000;

/**
 * Validates the cap and returns it.
 *
 * **`NaN` and `Infinity` are rejected rather than passed through**, because
 * both silently disable the bound: every `expansions > NaN` comparison is
 * false, and `Infinity` has no ceiling at all. A safeguard a caller can turn
 * off by accident is not a safeguard, and the failure it exists to prevent is
 * a hung tab — the one failure mode with no error message. Raised in review
 * on #257.
 */
function settleCap(options: SearchOptions): number {
  const cap = options.maxExpansions ?? DEFAULT_MAX_EXPANSIONS;
  if (!Number.isFinite(cap) || cap < 1) {
    throw new RangeError(
      `nav/search: maxExpansions must be a finite number of at least 1, got ${cap}`,
    );
  }
  return cap;
}

/**
 * A counter that throws once the cap is passed.
 *
 * Shared by both searches: the guard was duplicated, and a safeguard that
 * exists twice is one that can be fixed once.
 */
function expansionGuard(maxExpansions: number, from: string): () => void {
  let expansions = 0;
  return () => {
    if (++expansions > maxExpansions) {
      throw new RangeError(
        `nav/search: exceeded ${maxExpansions} expansions from ${from}`,
      );
    }
  };
}

/** A frontier entry: the state, and the key of whatever discovered it. */
interface Visit<S> {
  readonly state: S;
  readonly from: string | undefined;
}

/**
 * A shortest route from `start` to the first state satisfying `isGoal`.
 *
 * `undefined` means **no route exists**. Exhausting the expansion cap throws
 * instead — a caller cannot tell a blank answer from a search that gave up.
 *
 * Breadth-first, so the route is shortest in STEPS. Every edge is assumed to
 * cost the same; a space where that is false wants a different algorithm, not a
 * different key function.
 *
 * @throws `RangeError` if the cap is invalid or reached.
 */
export function findStatePath<S>(
  start: S,
  isGoal: (state: S) => boolean,
  space: StateSpace<S>,
  options: SearchOptions = {},
): S[] | undefined {
  const canEnter = space.canEnter ?? (() => true);
  const startKey = space.key(start);
  const countExpansion = expansionGuard(settleCap(options), startKey);

  if (isGoal(start)) return [start];

  const visited = new Map<string, Visit<S>>([
    [startKey, { state: start, from: undefined }],
  ]);
  const queue: S[] = [start];
  let head = 0;

  while (head < queue.length) {
    const state = queue[head++]!;
    countExpansion();

    const fromKey = space.key(state);
    for (const next of space.candidates(state)) {
      const nextKey = space.key(next);
      // SEEN CHECK BEFORE THE LEGALITY CALL. `canEnter` is the expensive half,
      // and asking it about a state already reached buys nothing.
      if (nextKey === fromKey || visited.has(nextKey)) continue;
      if (!canEnter(state, next)) continue;

      visited.set(nextKey, { state: next, from: fromKey });
      if (isGoal(next)) return trace(visited, nextKey);
      queue.push(next);
    }
  }

  return undefined;
}

/** Walks the parent links back from `key` to the root. */
function trace<S>(visited: ReadonlyMap<string, Visit<S>>, key: string): S[] {
  const path: S[] = [];
  let at: string | undefined = key;
  while (at !== undefined) {
    const visit: Visit<S> = visited.get(at)!;
    path.push(visit.state);
    at = visit.from;
  }
  return path.reverse();
}

/**
 * Every state reachable from `start`, keyed by its identity.
 *
 * Returns a map rather than a set because the states themselves are what a
 * caller wants — a `Column` cannot be recovered from its key string.
 */
export function reachableStates<S>(
  start: S,
  space: StateSpace<S>,
  options: SearchOptions = {},
): Map<string, S> {
  const canEnter = space.canEnter ?? (() => true);
  const countExpansion = expansionGuard(settleCap(options), space.key(start));

  const seen = new Map<string, S>([[space.key(start), start]]);
  const queue: S[] = [start];
  let head = 0;

  while (head < queue.length) {
    const state = queue[head++]!;
    countExpansion();

    const fromKey = space.key(state);
    for (const next of space.candidates(state)) {
      const nextKey = space.key(next);
      if (nextKey === fromKey || seen.has(nextKey)) continue;
      if (!canEnter(state, next)) continue;

      seen.set(nextKey, next);
      queue.push(next);
    }
  }

  return seen;
}
