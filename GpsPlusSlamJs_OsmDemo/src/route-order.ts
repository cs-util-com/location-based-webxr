/**
 * How far an agent may be ordered in one click, and what to do about a click
 * beyond it (DEC-R3).
 *
 * **The defect this replaces:** A* is bounded by an expansion cap, which buys a
 * reach of roughly 374–529 m of open ground depending on how many standable
 * levels a cell carries. The drawn scene is 2 400 m across. So a click in the
 * far half of the visible world returned `undefined`, and the UI reported "the
 * agent cannot reach that spot" — a confident lie, not a slow answer, and one
 * no test caught because the only long-route test supplies a score gradient that
 * gives A* real guidance.
 *
 * **Clamping rather than refusing**, by owner decision: the agent walks as far
 * as it can toward the click and says so. A player who clicked the horizon
 * wanted movement, not a message.
 *
 * **It also shrinks the search rather than growing it**, which is what makes it
 * compatible with the constraint recorded in `worker/protocol.ts`: the search
 * runs synchronously in the worker, so the expansion cap doubles as a
 * publish-latency bound and raising it delays the next publish.
 *
 * @see route-order.ts.md
 */

import type { LatLng } from "gps-plus-slam-osm";

/**
 * The furthest a single order may reach, in metres.
 *
 * **Set from the pessimistic end of the measured reach, not the optimistic
 * one.** The expansion cap bounds STATES, and a state is a `(cell, height)`
 * column: at one level per cell 20 000 states is an equal-area radius of ~529 m,
 * at two levels ~374 m. Choosing 529 would clamp to a distance the search cannot
 * reach wherever obstacles add a second level — which is exactly the ground a
 * player is most likely to click.
 *
 * 300 m leaves margin below 374 for the other reason a straight line understates
 * the search: **a route that detours is longer than the crow flies**, and the
 * cap counts the detour. Clamping therefore makes the refusal rare; it does not
 * make it impossible, and nothing here pretends otherwise.
 */
export const MAX_ORDER_M = 300;

/** Metres per degree of latitude — the spherical approximation used throughout. */
const M_PER_DEG_LAT = 111_320;

export interface ClampedOrder {
  /** Where the agent is actually being sent. */
  readonly to: LatLng;
  /** Whether {@link to} differs from what was asked for. */
  readonly clamped: boolean;
}

/**
 * Bring a destination within {@link MAX_ORDER_M} of the agent, along the line
 * the user pointed at.
 *
 * **Direction is preserved exactly**; only distance changes. Sending the agent
 * somewhere other than "toward where I clicked" would be a different order, not
 * a shortened one.
 *
 * The longitude scale is taken at the START latitude rather than at the
 * midpoint: the two differ by far less than the clamp's own margin at any
 * latitude a user stands, and using the start keeps the function total — a
 * midpoint would have to be derived from the answer it is computing.
 *
 * @param maxMetres - override for tests; defaults to {@link MAX_ORDER_M}.
 */
export function clampOrder(
  from: LatLng,
  to: LatLng,
  maxMetres: number = MAX_ORDER_M,
): ClampedOrder {
  const cosLat = Math.cos((from.lat * Math.PI) / 180);
  const dx = (to.lng - from.lng) * M_PER_DEG_LAT * cosLat;
  const dy = (to.lat - from.lat) * M_PER_DEG_LAT;
  const distance = Math.hypot(dx, dy);

  // NOT FINITE, OR NOT FURTHER: pass it through untouched. A NaN destination is
  // a fault upstream, and inventing a clamped position for it would turn a
  // visible failure into a plausible wrong answer.
  if (!Number.isFinite(distance) || distance <= maxMetres || distance === 0) {
    return { to, clamped: false };
  }

  const scale = maxMetres / distance;
  return {
    to: {
      lat: from.lat + (to.lat - from.lat) * scale,
      // Guard the pole: `cosLat` reaching zero would divide the longitude step
      // by nothing. There is no OSM ground there, so preserving the latitude
      // move and dropping the longitude one is the honest degenerate answer.
      lng: cosLat === 0 ? from.lng : from.lng + (to.lng - from.lng) * scale,
    },
    clamped: true,
  };
}
