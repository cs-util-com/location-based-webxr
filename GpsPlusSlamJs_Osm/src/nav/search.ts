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

/**
 * The extra functions a weighted search needs.
 *
 * Deliberately NOT members of {@link StateSpace}. A space describes the world —
 * how states are enumerated and identified — and has no opinion about price;
 * hanging `cost` off it would make the three breadth-first callers carry fields
 * their algorithm ignores, and `columnSpace()` would have to forward a notion of
 * cost it does not own.
 */
export interface CheapestOptions<S> extends SearchOptions {
  /**
   * The price of one legal step. Must be finite and **not negative**.
   *
   * A negative edge does not merely slow the search down, it breaks it: this
   * algorithm settles a state the first time it is popped, which is sound only
   * while no cheaper way to it can still turn up.
   */
  readonly cost: (from: S, to: S) => number;
  /**
   * A lower bound on the remaining cost to the goal. Must be finite and not
   * negative.
   *
   * **CONSISTENCY, NOT MERELY ADMISSIBILITY, IS THE CONTRACT** — because states
   * are settled on pop rather than re-opened. `h(a) <= cost(a, b) + h(b)` must
   * hold for every legal step. The production heuristic satisfies it by
   * construction: straight-line distance obeys the triangle inequality, and
   * every edge costs at least the distance it spans (the penalty never drops
   * below 1), so the bound can only be slack.
   *
   * A heuristic that returns 0 everywhere is always consistent, and turns this
   * into Dijkstra.
   */
  readonly heuristic: (state: S) => number;
}

/** Validates one caller-supplied number, naming which one it was. */
function requireFiniteNonNegative(value: number, what: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `nav/search: ${what} must be a finite number of at least 0, got ${value}`,
    );
  }
  return value;
}

/**
 * A frontier entry, with the running cost that ordered it.
 *
 * `f` is stored rather than recomputed because the heuristic is a caller's
 * function: calling it once per push, rather than once per comparison inside the
 * heap, keeps a costly heuristic from being paid a logarithmic number of times.
 */
interface Frontier<S> {
  readonly state: S;
  readonly key: string;
  readonly g: number;
  readonly f: number;
}

/**
 * A binary min-heap over the frontier, ordered by `f` and then by `g` descending.
 *
 * PRIVATE ON PURPOSE. It is an implementation detail of one function, it has no
 * meaning outside it, and exporting it would invite a second user with slightly
 * different ordering needs.
 *
 * **The tie-break is not cosmetic.** Among states with the same `f`, preferring
 * the larger `g` prefers the one nearer the goal, which reaches the goal after
 * expanding materially fewer states on open ground — exactly the shape of the
 * demo's own case, where large areas share one penalty and therefore tie
 * constantly.
 */
class FrontierHeap<S> {
  private readonly items: Frontier<S>[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: Frontier<S>): void {
    this.items.push(item);
    let at = this.items.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!this.before(this.items[at]!, this.items[parent]!)) break;
      this.swap(at, parent);
      at = parent;
    }
  }

  pop(): Frontier<S> | undefined {
    const top = this.items[0];
    if (top === undefined) return undefined;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let at = 0;
      for (;;) {
        const left = at * 2 + 1;
        const right = left + 1;
        let best = at;
        if (
          left < this.items.length &&
          this.before(this.items[left]!, this.items[best]!)
        ) {
          best = left;
        }
        if (
          right < this.items.length &&
          this.before(this.items[right]!, this.items[best]!)
        ) {
          best = right;
        }
        if (best === at) break;
        this.swap(at, best);
        at = best;
      }
    }
    return top;
  }

  private before(a: Frontier<S>, b: Frontier<S>): boolean {
    return a.f === b.f ? a.g > b.g : a.f < b.f;
  }

  private swap(a: number, b: number): void {
    const held = this.items[a]!;
    this.items[a] = this.items[b]!;
    this.items[b] = held;
  }
}

/**
 * The CHEAPEST route from `start` to the first state satisfying `isGoal`, under
 * {@link CheapestOptions.cost}.
 *
 * The weighted counterpart of {@link findStatePath}, and the algorithm
 * DEC-R13-1 asks for. Its contract matches the BFS everywhere it can:
 * `undefined` means no route exists, and exhausting the expansion cap throws
 * rather than returning a blank a caller could not tell apart from one.
 *
 * **THE GOAL IS TESTED ON POP, NOT ON DISCOVERY, and that is the whole
 * difference from the BFS.** Breadth-first may answer the moment it touches the
 * goal, because the first touch is along a shortest path by construction. Here
 * the first touch is merely the first, and a cheaper way to the same place can
 * still be sitting in the frontier — answering early would return a valid route
 * that is not the cheapest one, which is the failure this function exists to
 * prevent.
 *
 * **`canEnter` is consulted per EDGE here, not once per discovered state.** The
 * BFS may skip an already-seen state before paying for the decision because
 * every route to it is equally good; with weights, a later, cheaper approach to
 * the same state is a real thing and its legality is a different question. The
 * saving survives in the form that is still sound: a SETTLED state is skipped
 * before `canEnter` is asked, and on a large open space most candidates are
 * settled.
 *
 * @throws `RangeError` if the cap is invalid or reached, or if `cost` or
 *   `heuristic` returns a negative or non-finite number.
 */
export function findCheapestPath<S>(
  start: S,
  isGoal: (state: S) => boolean,
  space: StateSpace<S>,
  options: CheapestOptions<S>,
): S[] | undefined {
  const canEnter = space.canEnter ?? (() => true);
  const startKey = space.key(start);
  const countExpansion = expansionGuard(settleCap(options), startKey);

  if (isGoal(start)) return [start];

  const cameFrom = new Map<string, Visit<S>>([
    [startKey, { state: start, from: undefined }],
  ]);
  /** Cheapest known cost from the start, per key. */
  const bestG = new Map<string, number>([[startKey, 0]]);
  /** Keys already popped, whose cost can no longer improve. */
  const settled = new Set<string>();

  const frontier = new FrontierHeap<S>();
  frontier.push({
    state: start,
    key: startKey,
    g: 0,
    f: requireFiniteNonNegative(options.heuristic(start), "heuristic"),
  });

  for (;;) {
    const current = frontier.pop();
    if (current === undefined) return undefined;
    // A STALE ENTRY. The heap has no decrease-key, so a state improved while it
    // sat in the frontier is pushed again and the old entry is dropped here.
    // Cheaper than maintaining handles, and it is why `settled` exists at all.
    if (settled.has(current.key)) continue;
    settled.add(current.key);
    countExpansion();

    // ON POP, for the reason in the header: the first touch of the goal is not
    // necessarily the cheapest way to it.
    if (isGoal(current.state)) return trace(cameFrom, current.key);

    expand(current);
  }

  /** Offers every legal neighbour of `from` to {@link relax}. */
  function expand(from: Frontier<S>): void {
    for (const next of space.candidates(from.state)) {
      const nextKey = space.key(next);
      // A SETTLED NEIGHBOUR IS SKIPPED BEFORE `canEnter` IS ASKED. That is all
      // that survives of the BFS's "decide legality at most once per state"
      // saving — with weights, a later and cheaper approach to an UNsettled
      // state is a real thing whose legality is a separate question — and on
      // open ground most candidates are settled, so most of the saving remains.
      if (nextKey === from.key || settled.has(nextKey)) continue;
      if (!canEnter(from.state, next)) continue;
      relax(from, next, nextKey);
    }
  }

  /**
   * Records `next` as reached through `from`, if that is an improvement.
   *
   * Split out to keep the search loop readable rather than for reuse — the
   * "is this better, and if so remember three things about it" step is the one
   * place an off-by-one in the bookkeeping would produce a valid-looking route
   * that is not the cheapest.
   */
  function relax(from: Frontier<S>, next: S, nextKey: string): void {
    const step = requireFiniteNonNegative(
      options.cost(from.state, next),
      "cost",
    );
    const g = from.g + step;
    const known = bestG.get(nextKey);
    if (known !== undefined && known <= g) return;

    bestG.set(nextKey, g);
    cameFrom.set(nextKey, { state: next, from: from.key });
    frontier.push({
      state: next,
      key: nextKey,
      g,
      f: g + requireFiniteNonNegative(options.heuristic(next), "heuristic"),
    });
  }
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
