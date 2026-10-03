/**
 * The viewer's one way into the store for code votes, per AR entry (Tour
 * Viewer authoring plan 2026-09-28-0953 §3.2, M2e; owner decisions D9, D17,
 * D18; the seam contract in `viewer-placement.ts.md`):
 *
 * - **One solve per lock and per keep-alive tick (D18).** A voted lock's
 *   ring is ONE `recordGpsEventBatch`; a device fix that the keep-alive
 *   answers travels WITH its ring as one batch, the fix first. Every
 *   `recordGpsEvent` re-solves over the whole history, so 16 votes as 16
 *   dispatches cost 16 solves; the core (1.26) stores the same events and
 *   solves once; the compass memory steps once per batch (D18).
 * - **The soft trimming is a viewer-entry setting, never a global default.**
 *   The entry starts by clearing every override (`setAlignmentOverrides(null)`
 *   - `resetGpsSessionData` keeps them, so a previous entry's setting would
 *   otherwise carry into GPS-only solving the corpus never credited), turns
 *   the soft kernel on right before its first vote (merged over whatever is
 *   set, because the action replaces the whole object), and keeps it on
 *   until AR exit - across a tour switch too: the closed tour's votes stay
 *   in the GPS history, and the hard trim back on them is the 2.8-5.8 m
 *   jump M0b/M2b measured at a 5-8 m bias (M0c: keep it for the session).
 * - **A moved code's votes can be taken back (D20, M5c).** The sink keeps
 *   every device fix it stored; {@link ViewerVoteSink.retractVotes} turns
 *   the overrides off, resets the GPS history and re-feeds those fixes, in
 *   batches of at most {@link RETRACT_BATCH_SIZE}: the M5a recovery arm
 *   "refeed-soft-off", the only one that lands on the GPS answer (aged-out
 *   votes still held the alignment 5-8 m off after 10 minutes). With no vote
 *   left in the history the hard trim is safe; the next vote turns the soft
 *   trimming on again.
 *
 * @see viewer-vote-sink.ts.md
 */

import {
  recordGpsEvent,
  recordGpsEventBatch,
  resetGpsSessionData,
  setAlignmentOverrides,
  type AlignmentOverrides,
  type RecordGpsEventPayload,
} from "gps-plus-slam-app-framework/state";

/**
 * The solver setting M0c adopted for a session whose alignment a scanned code
 * holds (plan §3.2, D9): the core's gradual outlier falloff instead of the
 * hard 5 m trim - every pair keeps a say that shrinks with its residual
 * beyond r0, so the keep-alive hands the alignment back to GPS without a
 * jump. Rests on M0c (r0 = 1 m, p = 1 met the rule at a 3, 5, 8 and 15 m
 * bias with 8 or 16 votes on the 30 m ring and every hold and fade of
 * 60-180 s; largest step 0.02 m per fix) and M2a (the same through the
 * store's public path). What reverses it (M0c): p of 1.5 or more (the jump
 * returns), r0 of 3 m or more (the hold breaks, 0.66 m), the core's own
 * defaults r0 = 5 m, p = 2 (only blends, 0.76 m). The hard trim has to go
 * off with it, or both run and it behaves like the hard trim.
 */
export const VIEWER_SOFT_TRIM: Readonly<AlignmentOverrides> = Object.freeze({
  outlierFalloffEnabled: true,
  outlierFalloffRadiusMeters: 1,
  outlierFalloffExponent: 1,
  outlierRejectionEnabled: false,
});

/** The re-feed's batch size: the core's limit per `recordGpsEventBatch`
 *  (`MAX_GPS_EVENT_BATCH_SIZE`, core 1.26), so each batch is one solve. */
const RETRACT_BATCH_SIZE = 256;

/** The store surface the sink needs: dispatch, and the current overrides. */
interface VoteSinkStore {
  dispatch(
    action:
      | ReturnType<typeof recordGpsEvent>
      | ReturnType<typeof recordGpsEventBatch>
      | ReturnType<typeof resetGpsSessionData>
      | ReturnType<typeof setAlignmentOverrides>,
  ): unknown;
  getState(): {
    readonly gpsData?: {
      readonly alignmentOverrides?: AlignmentOverrides | null;
    } | null;
  };
}

export interface ViewerVoteSink {
  /** One voted lock's votes: one batch, the soft trimming on before it. */
  castLockVotes(votes: readonly RecordGpsEventPayload[]): void;
  /** One device fix and the keep-alive's ring for it: with a ring, ONE
   *  batch (the fix first, the soft trimming on before it); without one,
   *  the plain `recordGpsEvent` and no override change. */
  recordFix(
    fix: RecordGpsEventPayload,
    ring: readonly RecordGpsEventPayload[],
  ): void;
  /** Take every vote back (a moved code, D20): the overrides off, the GPS
   *  history reset (the zero stays), the device fixes this sink stored
   *  re-fed in batches of at most {@link RETRACT_BATCH_SIZE}. */
  retractVotes(): { refedFixes: number; batches: number };
}

/**
 * An AR entry starts: clear every override FIRST - before any fix or vote
 * of the entry, and on every entry, a plain-AR one included - then hand back
 * the entry's sink. A no-op on a store without a session zero yet (the core
 * keeps no overrides before one).
 */
export function startEntryVoteSink(store: VoteSinkStore): ViewerVoteSink {
  store.dispatch(setAlignmentOverrides(null));
  /** Whether THIS entry turned the soft trimming on; it stays on until the
   *  next entry's start clears it. */
  let softOn = false;
  /** Every device fix this sink stored, in order: what a retraction
   *  re-feeds. */
  const deviceFixes: RecordGpsEventPayload[] = [];

  function softBeforeVote(): void {
    if (softOn) return;
    const gpsData = store.getState().gpsData;
    // Without a session zero the core stores neither overrides nor votes,
    // so there is nothing to turn on yet; the next vote tries again.
    if (gpsData == null) return;
    store.dispatch(
      setAlignmentOverrides({
        ...(gpsData.alignmentOverrides ?? {}),
        ...VIEWER_SOFT_TRIM,
      }),
    );
    softOn = true;
  }

  return {
    castLockVotes(votes) {
      if (votes.length === 0) return;
      softBeforeVote();
      store.dispatch(recordGpsEventBatch({ events: [...votes] }));
    },
    recordFix(fix, ring) {
      deviceFixes.push(fix);
      if (ring.length === 0) {
        store.dispatch(recordGpsEvent(fix));
        return;
      }
      softBeforeVote();
      store.dispatch(recordGpsEventBatch({ events: [fix, ...ring] }));
    },
    retractVotes() {
      // The soft keys off FIRST, so every re-fed batch solves under the
      // core's own settings (M5a's "refeed-soft-off").
      store.dispatch(setAlignmentOverrides(null));
      softOn = false;
      store.dispatch(resetGpsSessionData());
      let batches = 0;
      for (let i = 0; i < deviceFixes.length; i += RETRACT_BATCH_SIZE) {
        store.dispatch(
          recordGpsEventBatch({
            events: deviceFixes.slice(i, i + RETRACT_BATCH_SIZE),
          }),
        );
        batches += 1;
      }
      return { refedFixes: deviceFixes.length, batches };
    },
  };
}
