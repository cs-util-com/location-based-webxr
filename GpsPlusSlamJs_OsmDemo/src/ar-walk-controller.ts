/**
 * Follows the user while AR is live: refetch when they have walked, warn when
 * they have walked far.
 *
 * **WHY THIS IS A MODULE AND NOT TWO `let`s IN `main.ts`.** The decision is
 * pure (`ar-walking.ts`), but it needs three pieces of state that have to
 * agree: where the data currently in the scene was fetched for, whether a pass
 * is running, and where the session was anchored. State in `main.ts` is state
 * no test can reach — and M1 of this plan shipped three modules that were each
 * correct in isolation with nothing asserting they were connected, which four
 * green gates did not notice.
 *
 * **ONE REFETCH, NOT TWO CALLS.** The caller supplies a single `refetch` that
 * must drive BOTH `loadTerrain` and `refresh` from the position it is given.
 * That is a correctness requirement, not tidiness: the worker joins terrain and
 * mesh on EXACT lat/lng equality, so an ungated `loadTerrain` on a newer
 * position than the gated `refresh` leaves `needsTerrainFor` permanently true
 * and every build waits out the full 15 s terrain timeout (plan §2.6).
 *
 * @see ar-walk-controller.ts.md
 */

import { greatCircleDistance, UNITS } from "h3-js";

import type { LatLng } from "gps-plus-slam-osm";

import { farTravelMessage, shouldRefreshFor } from "./ar-walking.js";

export interface ArWalkDeps {
  /**
   * Where the session was anchored — the framework's `zero`.
   *
   * FOR THE FAR-TRAVEL WARNING ONLY. It is the frame the alignment matrix is
   * expressed against, so it is what "drift" is measured from.
   */
  readonly origin: LatLng;
  /**
   * Where the data currently in the scene was fetched for.
   *
   * **A SEPARATE PARAMETER FROM `origin`, and conflating them was a real bug**
   * (r509 review). `zero` is the FIRST locate fix and immutable thereafter; the
   * scene's data was fetched for the store position, which a map click or a
   * picker choice moves without touching `zero`. Seeding the gate from `origin`
   * meant that after "locate, click 2 km away, enter AR" every real fix was
   * ~0 m from the seed — the gate never opened and AR showed the city from 2 km
   * away, indefinitely and with no error.
   */
  readonly dataAt: LatLng;
  /**
   * Refetch everything for this position — terrain AND scoring, one position.
   *
   * Must resolve when the whole pass is finished, because that is what reopens
   * the gate. `refresh()` is a `LatestOnly<void>` whose promise settles after
   * the last ring, so awaiting it is the honest signal; `loading.phase` is NOT
   * — it returns to `idle` after every ring while more are still coming.
   */
  readonly refetch: (position: LatLng) => Promise<void>;
  /** Tell the user they have walked far from the anchor. */
  readonly warn: (message: string) => void;
}

export interface ArWalk {
  /** Feed a new fix in. Cheap and synchronous; the work is fired, not awaited. */
  positionChanged(position: LatLng): void;
  /** Stop following. Idempotent. */
  dispose(): void;
}

/** Start following the user for the lifetime of an AR session. */
export function startArWalk(deps: ArWalkDeps): ArWalk {
  const origin = deps.origin;
  /**
   * Where the data currently in the scene was fetched for.
   *
   * **MEASURED FROM HERE, NOT FROM `origin`, and the difference is the whole
   * gate.** Measuring from the session origin would refetch once at 100 m and
   * then on EVERY subsequent fix, because every one of those is also more than
   * 100 m from the origin — the starvation case arriving by the opposite route.
   */
  let lastRefetchedAt: LatLng = deps.dataAt;
  let passInFlight = false;
  let disposed = false;

  return {
    positionChanged(position: LatLng): void {
      if (disposed) return;
      if (
        !shouldRefreshFor({ from: lastRefetchedAt, to: position, passInFlight })
      )
        return;

      // ADVANCED BEFORE THE AWAIT, and it stays advanced even if the pass
      // fails. A judgement call worth recording: holding it back after a
      // failure would retry from the position the user has already left, and
      // the data they need is where they ARE.
      lastRefetchedAt = position;
      passInFlight = true;

      const travelled = greatCircleDistance(
        [origin.lat, origin.lng],
        [position.lat, position.lng],
        UNITS.m,
      );
      const warning = farTravelMessage(travelled);
      // REPEATED ON EVERY QUALIFYING REFETCH, not once at the crossing. The
      // number in the message is what the user's decision turns on and it is
      // growing, so a single toast at 2 km is stale advice by 4 km. The cadence
      // is bounded by the gate itself — one warning per 100 m of walking.
      if (warning !== null) deps.warn(warning);

      // IN A `try`, because a `refetch` that throws SYNCHRONOUSLY would escape
      // before the `.finally` below exists and leave the gate shut for the rest
      // of the session — the exact failure that `finally` claims to have
      // removed (r509 review). A `Promise.resolve().then(...)` wrapper would
      // also fix it, at the cost of making the call asynchronous, which the
      // caller's `currentPass` handshake depends on NOT being.
      let pass: Promise<void>;
      try {
        pass = deps.refetch(position);
      } catch {
        passInFlight = false;
        return;
      }
      // `finally`, not `then`. A rejected pass that left the flag set would
      // wedge the gate shut for the rest of the session: one failed fetch and
      // AR silently stops following the user, with no error after the first.
      void pass
        .catch(() => undefined)
        .finally(() => {
          passInFlight = false;
        });
    },

    dispose(): void {
      disposed = true;
    },
  };
}
