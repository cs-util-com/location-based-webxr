/**
 * The order one tile's attempts visit the endpoint pool.
 *
 * WHY THIS IS A MODULE AND NOT `attempt % endpoints.length`. The pool has been
 * through three designs, and each fixed the previous one's real defect while
 * introducing its own:
 *
 * 1. **Random start** (until 2026-07-28) — spread load, but made the pool order
 *    decorative: every client drew uniformly, so the slowest instance served its
 *    full share. Measured 4.2x slower than the fastest host on identical work.
 * 2. **Strict preference order** (2026-07-28 → 2026-08-19) — the fastest host
 *    always first, and the cost was named at the time: "the cost is herding:
 *    every client now tries `endpoints[0]` first". The twelfth testing session
 *    is that cost arriving — a 429 on entry 0, every time.
 * 3. **This.** Weighted draw, so the measured-best host is most likely but not
 *    certain, and the herd spreads without the pool order becoming decorative.
 *
 * **AND ONE FACT NEITHER OF THE FIRST TWO KNEW.** Five entries are three
 * operators (`overpass-operators.ts`), so a draw over ENTRIES gives FOSSGIS
 * three tickets in every raffle and makes a 429 on one of them predict a 429 on
 * the next. This draws over OPERATORS first and picks an entry within the
 * chosen operator second, which is why the sequence visits three distinct
 * quotas before it revisits any.
 *
 * @see endpoint-order.ts.md
 */

import { operatorForUrl } from "./overpass-operators.js";

/**
 * How likely an operator is to be drawn, relative to the others.
 *
 * A WEIGHT, NOT A RANK, and not a latency either. Latencies here do not
 * replicate — `spatial/resolutions.ts` records the same work at 15.1 / 32.9 /
 * 82.9 / 91.1 s — so a weight computed as `1 / median` would be a precise
 * function of noise. Coarse tiers are the honest shape: they say "prefer this
 * one" without claiming to know by how much.
 */
export type OperatorWeights = Readonly<Record<string, number>>;

/** Used for any operator the weights do not mention. */
export const DEFAULT_OPERATOR_WEIGHT = 1;

/**
 * The endpoints to try, in the order to try them.
 *
 * The returned array is a permutation of `endpoints` — **every entry is
 * reachable**, which the plain modulo it replaces could not promise once
 * `maxRetries` was smaller than the pool.
 *
 * Two rules, applied in this order:
 *
 * 1. **Distinct operators first, drawn by weight without replacement.** So the
 *    first three attempts against the default pool hit three different quotas.
 *    A refusal from one says nothing about the next, which is exactly the
 *    property the old modulo destroyed.
 * 2. **Within an operator, its entries in pool order.** They share a quota, so
 *    there is nothing to gain by randomising between them, and pool order is
 *    already the measured preference.
 *
 * `random` is injected and must return `[0, 1)`. Tests pass a scripted sequence;
 * production passes `Math.random`.
 */
export function planEndpointOrder(
  endpoints: readonly string[],
  weights: OperatorWeights,
  random: () => number,
): readonly string[] {
  // Group first, preserving pool order within each operator.
  const byOperator = new Map<string, string[]>();
  for (const endpoint of endpoints) {
    const operator = operatorForUrl(endpoint);
    const existing = byOperator.get(operator);
    if (existing === undefined) byOperator.set(operator, [endpoint]);
    else existing.push(endpoint);
  }

  // Draw the operator order by weight, without replacement.
  const remaining = [...byOperator.keys()];
  const operatorOrder: string[] = [];
  while (remaining.length > 0) {
    operatorOrder.push(takeWeighted(remaining, weights, random));
  }

  // Round-robin across the drawn operator order: one entry from each, then the
  // next entry from each. That is what makes "never two attempts on one
  // operator while an untried operator remains" true by construction rather
  // than by a check somewhere else.
  const queues = operatorOrder.map((operator) => [
    ...(byOperator.get(operator) ?? []),
  ]);
  const order: string[] = [];
  while (order.length < endpoints.length) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next !== undefined) order.push(next);
    }
  }
  return order;
}

/**
 * Removes and returns one operator, chosen with probability proportional to its
 * weight.
 *
 * Mutates `remaining` because the caller wants a draw WITHOUT replacement and
 * the alternative is rebuilding the array per draw for a list of three.
 *
 * A non-positive or non-finite weight is floored to zero rather than rejected —
 * a misconfigured weight should make an operator unlikely, never crash a fetch
 * — and if every remaining weight is zero the draw degrades to the first entry,
 * which keeps the pool reachable instead of dividing by zero.
 */
function takeWeighted(
  remaining: string[],
  weights: OperatorWeights,
  random: () => number,
): string {
  const weightOf = (operator: string): number => {
    const raw = weights[operator] ?? DEFAULT_OPERATOR_WEIGHT;
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  };

  const total = remaining.reduce((sum, o) => sum + weightOf(o), 0);
  if (total <= 0) return remaining.splice(0, 1)[0] as string;

  // `random()` is [0, 1), so `target` is [0, total) and the loop always lands.
  let target = random() * total;
  for (let i = 0; i < remaining.length; i++) {
    target -= weightOf(remaining[i] as string);
    if (target < 0) return remaining.splice(i, 1)[0] as string;
  }
  // Unreachable while `random()` honours its contract; a `random` that returns
  // exactly 1 would fall through here rather than off the end of the array.
  return remaining.splice(remaining.length - 1, 1)[0] as string;
}
