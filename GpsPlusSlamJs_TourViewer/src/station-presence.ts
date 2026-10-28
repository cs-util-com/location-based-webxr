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
 * - **Hold** with no position to judge by (plan §3: a tracking drop, a
 *   stale fix): nothing changes. Two cases are no hold (PR review S1): a
 *   fix too weak to guide by (above the accuracy ceiling) never enters or
 *   takes over but still ENDS presence once it is past the found exit even
 *   by its accuracy (`presentAfterWeakFix`, an underpass); and the caller
 *   (`station-guide.ts`) clears a station a code made present once the
 *   code goes and nothing else can judge (a moved poster's veto), and at
 *   the AR session's end.
 * - **Not the order** (V-D5): every station of the tour is a candidate,
 *   offered or not, found or done; the story still starts only at an
 *   offered station (the run).
 *
 * Pure. `station-presence.sweep.test.ts` measures the wrong-station rate and the
 * flicker behind the margin.
 */

import {
  POSITION_PRECISION_CEILING_M,
  type PositionPrecision,
} from "gps-plus-slam-app-framework/state/position-precision";

import type { StationBands } from "./station-bands.js";

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
 * The takeover margin's floor (m): what a position a code holds takes
 * (`'code'` precision: no number, `position-precision`). Swept 0-3 m against the
 * aligned position's jitter 0.05-0.5 m, the flicker counted directly
 * (`station-presence.sweep.test.ts`, the sidecar's Evidence): 0 flickers
 * where circles overlap; 0.5 m holds only while the jitter stays near 5 cm,
 * 1 m up to 0.25 m; each further 0.5 m keeps the previous exhibit about
 * 2-5 points of the time longer. Reversed by a field measurement of the
 * aligned position's jitter, in either direction: below about 0.1 m, 0.5 m
 * wins (about 1.4 points fewer wrong stations); about 0.5 m, 1 m flickers
 * and 1.5-2 m win.
 */
export const TAKEOVER_MARGIN_MIN_M = 1;

/**
 * The takeover margin `m` (m) for a judged position, by its precision
 * (`gps-plus-slam-app-framework/state/position-precision`): how much nearer
 * a neighbour must be than the present station before it takes over while
 * both circles hold the position.
 * - A code holds the position (`'code'`): the floor.
 * - Otherwise the reported accuracy (the device fixes'), at least
 *   `TAKEOVER_MARGIN_MIN_M`, at most the precision rule's ceiling (above it
 *   only the exit is judged, `presentAfterWeakFix`); a missing or nonsense
 *   one (`'none'`) reads as the ceiling, as the bands' clamp reads it.
 *
 * The sweep's verdict: a margin must match the position's noise - no fixed
 * value in 0-3 m keeps a raw fix of 8-25 m from switching neighbours, while
 * the accuracy reduces that flicker at least twofold, within half a point
 * of the wrong-station rate. Its factor (1x the accuracy) is right only
 * while the phone reports its error honestly, and the sweep (0.5-2x on
 * reports 0.5/1/2x the true error) reverses it both ways: a phone that
 * reports HALF its error wants about 2x (a third less flicker or better);
 * one that reports DOUBLE wants about 0.5x (2-4 points fewer wrong
 * stations). Field data comparing reported and true error decides it.
 * No cap below the spacing: where the margin exceeds it (a GPS-only
 * museum) the position's noise, not the margin, is what fails.
 */
export function takeoverMarginM(precision: PositionPrecision): number {
  if (precision.source === "code") return TAKEOVER_MARGIN_MIN_M;
  const accuracyM = precision.accuracyM;
  // A missing or nonsense accuracy reads as the ceiling, as the bands'
  // clamp reads it (`station-bands.ts`; PR review N1).
  if (accuracyM === null || !Number.isFinite(accuracyM) || accuracyM <= 0) {
    return POSITION_PRECISION_CEILING_M;
  }
  return Math.min(
    Math.max(accuracyM, TAKEOVER_MARGIN_MIN_M),
    POSITION_PRECISION_CEILING_M,
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

/**
 * The present station after a fix too weak to guide by (a `'gps'`
 * precision that is `tooWeak`, above the accuracy ceiling; PR review S1): it never enters a station nor
 * hands over to one, but it ends presence when even `accuracyM` nearer the
 * visitor the position would be past the present station's found exit
 * (`d - accuracy > foundExit`: an underpass fix that places the visitor
 * well away). Holds on anything it cannot read (no candidates, the present
 * station not among them, a nonsense distance or accuracy).
 */
export function presentAfterWeakFix(
  presentId: string | null,
  candidates: readonly PresenceCandidate[] | null,
  accuracyM: number,
): string | null {
  if (presentId === null || candidates === null) return presentId;
  if (!Number.isFinite(accuracyM) || accuracyM < 0) return presentId;
  const present = candidates.find((c) => c.id === presentId && usable(c));
  if (present === undefined) return presentId;
  return pastFoundExit(present, accuracyM) ? null : presentId;
}

/**
 * Whether a position is past one station's found exit by that station's
 * own distance, with `slackM` nearer the visitor still counted: 0 for a
 * judged position (`d > foundExit`), the accuracy for a fix too weak to
 * guide by (`d - accuracy > foundExit`, as `presentAfterWeakFix`). False on
 * anything it cannot read (a nonsense distance, band or slack). The guide
 * finishes a tour waiting on its last station by it: leaving is that
 * station's own distance, never "another station is present".
 */
export function pastFoundExit(c: PresenceCandidate, slackM: number): boolean {
  if (!usable(c) || !Number.isFinite(slackM) || slackM < 0) return false;
  return c.distanceM - slackM > c.foundExitM;
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
