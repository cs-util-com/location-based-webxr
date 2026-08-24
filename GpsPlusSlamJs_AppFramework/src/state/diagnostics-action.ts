/**
 * `diagnostics/note` — an action dispatched to be RECORDED, and for nothing
 * else (owner decision, 2026-08-23).
 *
 * **WHY THIS EXISTS.** Some of the most useful numbers a session produces are
 * measurements the app makes about itself: how long the AR entry waited before
 * it was ready, how long the elevation estimator took to engage. They are shown
 * on screen as a toast, which is enough to read one of them on a walk and
 * nothing at all afterwards. Putting them in the persisted action stream means
 * a recording can be opened later and asked what actually happened.
 *
 * **WHY IT HAS NO REDUCER, AND WHY THAT IS THE POINT.** The owner's requirement
 * was that it be *"not really consumed by the store"*. The persistence
 * middleware writes each action AFTER `next(action)` has run, and every slice
 * is a plain RTK `createSlice` that ignores an unmatched type — so an action
 * with no reducer at all is persisted exactly like any other and changes
 * nothing. A reducer added later would make the action ambiguous: is the
 * recording the record, or is the state? `diagnostics-action.test.ts` asserts
 * the absence.
 *
 * ⚠️ **AND WHY IT IS INERT IN SOME APPS TODAY.** The middleware only writes
 * while a session is recording, into whatever `StorageBackend` the store was
 * built with. The OSM demo builds its store with a `NullStorageBackend` by
 * explicit design — *"this demo records nothing, and a real backend here would
 * start writing GPS actions to OPFS behind the user's back"* — so diagnostics
 * dispatched there are dropped until that decision changes. Shipped anyway, at
 * the owner's instruction, so the day the demo records nothing else has to be
 * built. The trade is written up in
 * `GpsPlusSlamJs_Docs/docs/2026-08-23-2335-diagnostic-actions-into-recordings-findings.md`.
 *
 * **The prefix is the whole contract.** `createPersistenceMiddleware` keeps a
 * whitelist of slice prefixes and drops everything else **silently** — no
 * warning, no error. `diagnostics` is in the store factory's built-in list,
 * derived through `slicePrefixOf(recordDiagnostic.type)` rather than written as
 * a literal, for the reason recorded there: a literal `refPointsV2/` outlived
 * its rename once and took a whole slice's actions out of every recording.
 *
 * @see diagnostics-action.ts.md
 */

import { createAction } from '@reduxjs/toolkit';

/**
 * What a diagnostic note carries.
 *
 * Deliberately loose in `detail` and deliberately strict about its VALUES: the
 * action is JSON-serialised into the recording, and RTK's serialisable check
 * runs over it, so a `Date`, a `Map` or a class instance would either warn in
 * development or round-trip into something else. Numbers, strings, booleans and
 * `null` survive a zip unchanged.
 */
export interface DiagnosticNote {
  /**
   * What was measured, as a stable slug — e.g. `"ar-entry-ready"`.
   *
   * A slug rather than a free-text sentence because the value of a recording is
   * being able to find every instance of one measurement across many sessions,
   * and prose does not group.
   */
  readonly kind: string;
  /**
   * When, in EPOCH milliseconds.
   *
   * Supplied rather than taken here, so the caller controls what moment is
   * stamped — but the DOMAIN is fixed: a caller measuring on another clock
   * (an XR frame clock, `performance.now()`) converts to epoch ms once, at
   * dispatch, exactly as `main.ts` does with `nowEpochMs()`. Two reasons the
   * domain is part of the contract rather than the caller's choice: a note is
   * read back months later, out of a zip, where only an absolute timeline can
   * be placed against the session's other events; and the replay engine's
   * `extractActionTimestamp` paces recordings by this field, so a frame-clock
   * value would compute garbage delays against the epoch-stamped GPS stream.
   */
  readonly atMs: number;
  /** The measurement itself. Flat, and JSON-safe by construction. */
  readonly detail: Readonly<Record<string, number | string | boolean | null>>;
}

/**
 * Record a diagnostic note into the session's action stream.
 *
 * A no-op unless a recording is running and the store was built with a real
 * `StorageBackend`; nothing observes it in state, by design.
 */
export const recordDiagnostic =
  createAction<DiagnosticNote>('diagnostics/note');
