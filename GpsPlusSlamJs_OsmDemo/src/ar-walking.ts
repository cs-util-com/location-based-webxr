/**
 * Walking while an AR session is live — when to refetch, and when to warn.
 *
 * **THE FAILURE THIS MODULE EXISTS TO PREVENT IS SILENT WORK** (plan §2.6). The
 * demo has no GPS→position path today; every position change comes from the
 * map, and `positionChanged` fires `loadTerrain` and `refresh` on each one with
 * no gate. Wiring the framework's GPS watch in looks like one line, and that
 * line starves the cycle: `refresh` is `latestOnly`, so a new run aborts the one
 * in flight. At 1 Hz against a 15–90 s pass, every run is aborted by the next
 * and **nothing ever publishes** — no error, no empty state, just a view that
 * never changes while the worker runs flat out.
 *
 * So there are two conditions, and the gate is closed by EITHER: the user has
 * not moved far enough, or a pass is already running.
 *
 * **THE GATE MUST COVER `loadTerrain` TOO, WITH THE SAME POSITION**, and that
 * is a correctness requirement rather than symmetry. The worker joins the
 * terrain and the mesh build on EXACT lat/lng equality — right today, because
 * both numbers come from the same store position. Under a 1 Hz watch every fix
 * is a fresh double, so an ungated `loadTerrain` running on the newest position
 * while a gated `refresh` runs on an older one leaves `needsTerrainFor`
 * permanently true, and every build waits out the full 15 s terrain timeout
 * before drawing on whatever field it happens to hold. Gate both with one
 * position, or relax the join — and relaxing it is the worse of the two.
 *
 * @see ar-walking.ts.md
 */

import { greatCircleDistance, UNITS } from "h3-js";

import type { LatLng } from "gps-plus-slam-osm";

/**
 * How far the user must walk before AR refetches, metres.
 *
 * **BOUNDED FROM BOTH SIDES, and the bounds are what the tests pin** — the
 * number itself is a choice inside them.
 *
 * - **Above ~30 m**, because an urban GPS fix wanders 10–30 m while the phone
 *   sits still, and a threshold inside that band means a stationary user pays
 *   for a full 21 MB fetch and a re-scored working set over and over.
 *   **The cost is waste, NOT starvation** — an earlier version of this comment
 *   said starvation and was wrong (r509 review). `passInFlight` makes
 *   starvation impossible at ANY threshold, which is precisely what that flag
 *   buys; overstating the bound here would be the argument a future reader used
 *   to decide the flag was redundant.
 * - **Below ~124 m**, because the scoring working set reaches ~250 m
 *   (`SCORE_DISK_MAX_RADIUS = 4`). A refresh triggered after D metres lands
 *   1.4·T metres later at walking pace, so the user is `D + 1.4·T` from the last
 *   scored centre when the data arrives — at the 90 s worst case, `D + 126`.
 *   Past 250 m they are standing outside the scored disc entirely.
 *
 * 100 m is ~71 s of walking. **DESIGNED AGAINST THE 90 s END, not against a
 * "typical" pass** — `resolutions.ts` measured 15.1 / 32.9 / 82.9 / 91.1 s for
 * four fetches and says outright that "a single latency quoted here is quoting
 * noise", with three previous retractions on record for exactly this pattern.
 * An earlier version of this comment called 15 s typical; it is the fastest of
 * four.
 */
export const AR_REFRESH_DISTANCE_M = 100;

/**
 * How far from the session origin before the user is told, metres.
 *
 * **THE LOWER EDGE OF AN OPEN BAND. There is no upper one, and the "2–5 km"
 * this replaced was a real defect rather than a wording slip** (r504 review).
 * 5 000 m is `REANCHOR_THRESHOLD_M`, so a band ending there stops warning
 * exactly where the projection error is worst — and, since AR suppresses the
 * re-anchor outright, where nothing else will fire either.
 *
 * Below the re-anchor threshold so the two cannot collide: the user has to hear
 * about the drift before the distance at which un-suppressed code would have
 * re-taken the origin. At 2 km the projection error is ~1.1 m and growing
 * quadratically; at 10 km it is ~19 m (§2.4).
 */
export const FAR_TRAVEL_WARN_M = 2000;

export interface RefreshGateInput {
  /** Where the data currently in the scene was fetched for. */
  readonly from: LatLng;
  /** The new fix. */
  readonly to: LatLng;
  /** Whether a scoring pass is already running. */
  readonly passInFlight: boolean;
}

/**
 * Whether this position change should trigger a refetch.
 *
 * **CLOSED BY EITHER CONDITION**, and `passInFlight` is not implied by the
 * distance: a fast walker crosses the threshold again before a slow pass
 * finishes, and re-triggering there aborts the run that was about to publish.
 *
 * Returns `false` for a non-finite position. `greatCircleDistance` yields `NaN`
 * rather than throwing and every comparison against `NaN` is false, so the
 * closed direction is what a bad fix would produce anyway — this makes it the
 * deliberate answer rather than an accident of operator choice.
 */
export function shouldRefreshFor(input: RefreshGateInput): boolean {
  if (input.passInFlight) return false;
  if (!isFinitePosition(input.from) || !isFinitePosition(input.to))
    return false;

  const travelled = greatCircleDistance(
    [input.from.lat, input.from.lng],
    [input.to.lat, input.to.lng],
    UNITS.m,
  );
  // STRICTLY GREATER, matching `nextAnchor`'s convention so the two modules
  // round the same way and nobody has to remember which is which.
  return travelled > AR_REFRESH_DISTANCE_M;
}

/**
 * What to tell the user about how far they have walked, or `null` for nothing.
 *
 * **REPORT, DO NOT CORRECT** (§2.4). `zero` is immutable and re-anchoring
 * mid-session would reintroduce the disagreement the fixed-origin work removed,
 * so the honest response to drift is to name it, with the number.
 *
 * **THE REMEDY IS A RELOAD, AND THE FIRST VERSION OF THIS MESSAGE SAID "LEAVE
 * AND RE-ENTER AR", WHICH DOES NOTHING** (r509 review). `setZeroPos`'s reducer
 * is `state === null ? next : state` — a no-op once set — and nothing in this
 * demo or in the framework's teardown resets it. Re-entering AR re-reads the
 * SAME `zero`, so the projection error is exactly what it was. Only a reload
 * re-anchors.
 *
 * Advice that does not work is worse than no advice: the user follows it, sees
 * no change, and concludes the drift is unavoidable rather than fixable.
 */
export function farTravelMessage(distanceM: number): string | null {
  if (!Number.isFinite(distanceM)) return null;
  if (distanceM < FAR_TRAVEL_WARN_M) return null;
  const km = (distanceM / 1000).toFixed(1);
  return `You are ${km} km from where this AR session was anchored — placement drifts with distance. Reload the page here to re-anchor.`;
}

/** Both coordinates present and finite. */
function isFinitePosition(position: LatLng): boolean {
  return Number.isFinite(position.lat) && Number.isFinite(position.lng);
}
