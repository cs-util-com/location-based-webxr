/**
 * Which ONE station the visitor is at (visitor plan 2026-10-18-2349 §3, D7,
 * D9, V-D0, V-D5): the station whose content is shown. Separate from
 * "found", which stays the story's latch (`station-run.ts`): presence comes
 * and goes as the visitor walks, found never reverts.
 *
 * - **Enter** at the station's found radius (V-D0: the circle the editor
 *   shows), on the same judged position the run finds by.
 * - **Leave** past the found exit (found radius plus the band,
 *   `station-bands.ts`), so a position wandering around the edge does not
 *   blink the content.
 * - **One at a time** (D9). A neighbour B takes over from the present A
 *   when the position is inside B's found radius AND either A's exit is
 *   passed or B is nearer by more than the takeover margin `m`
 *   (`d_B + m < d_A`, `takeoverMarginM`: the judged accuracy, at least
 *   1 m). With none present, the nearest station whose found
 *   radius holds the position (list order on a tie).
 * - **Hold** with no judged position (a tracking drop, a stale fix, a GPS
 *   too weak to guide by): nothing changes. The caller clears presence when
 *   the AR session ends.
 * - **Not the order** (V-D5): every station of the tour is a candidate,
 *   offered or not, found or done; the story still starts only at an
 *   offered station (the run).
 *
 * Pure. `station-presence.sweep.test.ts` measures the wrong-station and the
 * switch rates behind the margin.
 */

import { ACCURACY_CEILING_M, type StationBands } from "./station-bands.js";

/** One station as presence judges it, at one judged position. */
export interface PresenceCandidate {
  readonly id: string;
  /** Horizontal distance from the judged position (m). */
  readonly distanceM: number;
  /** The authored found radius (m): presence starts inside it. */
  readonly foundM: number;
  /** The found exit (m, found radius plus the band): presence ends beyond. */
  readonly foundExitM: number;
}

/**
 * The takeover margin's floor (m): what a position a code lined up takes
 * (its accuracy is unknown, `judgedAccuracy`). Swept 0-3 m against the
 * aligned position's jitter 0.05-0.5 m (`station-presence.sweep.test.ts`,
 * the sidecar's Evidence): 0 flickers where circles overlap; 0.5 m stops it
 * only while the jitter stays near 5 cm, 1 m up to 0.25 m; each further
 * 0.5 m keeps the previous exhibit about 1-4 points of the time longer.
 * Reversed by a field measurement of the aligned position's jitter: below
 * about 0.1 m, 0.5 m wins; about 0.5 m, 1.5 m does.
 */
export const TAKEOVER_MARGIN_MIN_M = 1;

/**
 * The takeover margin `m` (m) for a judged position: how much nearer a
 * neighbour must be than the present station before it takes over while
 * both circles hold the position. The judged accuracy (the raw fixes',
 * without a code; null with one), at least `TAKEOVER_MARGIN_MIN_M`, at most
 * the accuracy ceiling (above it nothing is judged). The sweep's verdict: a
 * margin must match the position's noise - no fixed value in 0-3 m stops a
 * raw fix of 8-20 m from switching neighbours several times per visit,
 * while one band (the accuracy) does, at no worse wrong-station rate.
 */
export function takeoverMarginM(judgedAccuracyM: number | null): number {
  if (judgedAccuracyM === null || !Number.isFinite(judgedAccuracyM)) {
    return TAKEOVER_MARGIN_MIN_M;
  }
  return Math.min(
    Math.max(judgedAccuracyM, TAKEOVER_MARGIN_MIN_M),
    ACCURACY_CEILING_M,
  );
}

function usable(c: PresenceCandidate): boolean {
  return (
    Number.isFinite(c.distanceM) &&
    Number.isFinite(c.foundM) &&
    Number.isFinite(c.foundExitM)
  );
}

/**
 * The present station after one judged position.
 *
 * @param presentId the station present before, or null.
 * @param candidates every station measured at the judged position
 *   (`presenceCandidates`); null when nothing may be judged: presence holds.
 * @param marginM the takeover margin (`takeoverMarginM`); nonsense or
 *   negative reads as none.
 */
export function nextPresentStation(
  presentId: string | null,
  candidates: readonly PresenceCandidate[] | null,
  marginM: number,
): string | null {
  if (candidates === null) return presentId;
  const margin = Number.isFinite(marginM) && marginM > 0 ? marginM : 0;
  const kept = keptPresent(presentId, candidates);
  let best: PresenceCandidate | undefined;
  for (const c of candidates) {
    if (!takesOver(c, kept, margin)) continue;
    if (best === undefined || c.distanceM < best.distanceM) best = c;
  }
  return best?.id ?? kept?.id ?? null;
}

/** The present station while its exit holds the position (and only while
 *  it is measured at all). */
function keptPresent(
  presentId: string | null,
  candidates: readonly PresenceCandidate[],
): PresenceCandidate | undefined {
  if (presentId === null) return undefined;
  const present = candidates.find((c) => c.id === presentId && usable(c));
  return present !== undefined && present.distanceM <= present.foundExitM
    ? present
    : undefined;
}

/** Whether `c` may become present: inside its found radius, and - while
 *  another station is kept - nearer than it by more than the margin. */
function takesOver(
  c: PresenceCandidate,
  kept: PresenceCandidate | undefined,
  margin: number,
): boolean {
  if (c.id === kept?.id || !usable(c) || c.distanceM > c.foundM) return false;
  return kept === undefined || c.distanceM + margin < kept.distanceM;
}

/**
 * Every station with a distance at the judged position, as presence judges
 * it (V-D5: no order, no offer, no run state), with its bands by the same
 * rule the run and the HUD use (`judgedStationBands`, passed in as
 * `bandsOf`). Null when no station has a distance (no position, or no GPS
 * zero yet): presence then holds.
 */
export function presenceCandidates<
  S extends { readonly id: string; readonly foundRadiusM: number },
>(
  stations: readonly S[],
  distances: ReadonlyMap<string, number>,
  bandsOf: (station: S) => Pick<StationBands, "foundM" | "foundExitM">,
): PresenceCandidate[] | null {
  const out: PresenceCandidate[] = [];
  for (const station of stations) {
    const d = distances.get(station.id);
    if (d === undefined) continue;
    const { foundM, foundExitM } = bandsOf(station);
    out.push({ id: station.id, distanceM: d, foundM, foundExitM });
  }
  return out.length === 0 ? null : out;
}
