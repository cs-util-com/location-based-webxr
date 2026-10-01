/**
 * What gets replayed, and how one pass is wired to a store.
 *
 * The timed unit is ONE dispatch of a recorded `gpsData/recordGpsEvent` -
 * the same call the live recorder makes per GPS fix, and the one inside which
 * the library runs its alignment solve - or of a `gpsData/recordGpsEventBatch`
 * (core 1.26: several observations, ONE solve; the Tour Viewer records its
 * device fixes with the code keep-alive's ring this way), which is a solve
 * of its own and is timed as one unit. Nothing is rebuilt: the recorded
 * actions are dispatched exactly as the replay engine dispatches them, so
 * there is no second code path for the timing page to drift away from.
 *
 * ONLY THE ZERO AND THE GPS ACTIONS ARE REPLAYED AND THE REST IS DROPPED,
 * deliberately: `gpsData/setZeroPos` (without a session zero the solve does
 * not run at all) and the fixes (`gpsData/recordGpsEvent`, and
 * `gpsData/recordGpsEventBatch`). A recording also carries compass
 * opt-ins, frame captures, depth samples and ref points; replaying those would
 * let the RECORDING reconfigure the solve, so a walk captured with an opt-in
 * on would be measuring a different configuration from one captured without
 * it. The configuration here comes from the arm and from nowhere else.
 *
 * The store is injected rather than imported so this module is testable
 * against a fake that records dispatches; the page supplies the real one.
 */

import type { RecordedAction } from 'gps-plus-slam-app-framework/storage/zip-reader';
import { setAlignmentOverrides } from 'gps-plus-slam-app-framework/state';
import {
  GPS_EVENT_ACTION_TYPES,
  recordedGpsEventPayloads,
} from 'gps-plus-slam-app-framework/utils/gps-event-actions';
import type { TimingArm } from './alignment-timing-arms';

const ZERO_ACTION = 'gpsData/setZeroPos';

/** Which recorded actions a pass dispatches, and when. */
export interface TimingReplayPlan {
  /** Dispatched once per pass, OUTSIDE the timed span. */
  readonly preamble: readonly RecordedAction[];
  /** `groups[i]` is dispatched as the timed unit of fix `i`; it ends with the fix. */
  readonly groups: readonly (readonly RecordedAction[])[];
  readonly fixCount: number;
  /** Wall-clock span between the first and last fix, or null when unknown. */
  readonly durationSeconds: number | null;
}

/** The first finite `rawGpsPoint.timestamp` among the GPS events the action
 *  carries (one for a fix, the batch's events for a batch); null when none. */
function fixTimestamp(action: RecordedAction): number | null {
  for (const event of recordedGpsEventPayloads(action)) {
    if (typeof event !== 'object' || event === null) continue;
    const point = (event as { rawGpsPoint?: unknown }).rawGpsPoint;
    if (typeof point !== 'object' || point === null) continue;
    const ts = (point as { timestamp?: unknown }).timestamp;
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  }
  return null;
}

/**
 * Split a loaded recording's action stream into an untimed preamble and one
 * dispatch group per GPS fix.
 *
 * A session zero that appears after the first fix (a re-zero) rides with the
 * fix that follows it, so the recorded order is preserved exactly rather than
 * hoisted to the front, which would replay the rest of the walk against the
 * wrong origin.
 */
export function planTimingReplay(
  actions: readonly RecordedAction[]
): TimingReplayPlan {
  const preamble: RecordedAction[] = [];
  const groups: RecordedAction[][] = [];
  let pending: RecordedAction[] = [];
  let firstTs: number | null = null;
  let lastTs: number | null = null;

  for (const action of actions) {
    if (action.type === ZERO_ACTION) {
      pending.push(action);
      continue;
    }
    if (!GPS_EVENT_ACTION_TYPES.includes(action.type)) continue;
    if (groups.length === 0) {
      // Everything before the FIRST fix is setup the app pays once per
      // session, so it is dispatched outside the timed span.
      preamble.push(...pending);
      pending = [];
    }
    // A zero seen after fixing has begun rides with this fix instead.
    const group = [...pending, action];
    pending = [];
    groups.push(group);
    const ts = fixTimestamp(action);
    if (ts !== null) {
      if (firstTs === null) firstTs = ts;
      lastTs = ts;
    }
  }
  // Trailing zeros after the last fix are dropped: nothing would be timed
  // after them, and dispatching them would change no measured cost.
  const durationSeconds =
    firstTs !== null && lastTs !== null && lastTs > firstTs
      ? (lastTs - firstTs) / 1000
      : null;

  return { preamble, groups, fixCount: groups.length, durationSeconds };
}

/** The part of a store this module uses. Structural, so a fake is enough. */
export interface TimingStoreLike {
  dispatch(action: { type: string; payload?: unknown }): void;
}

export interface CreatePassFactoryInput {
  readonly plan: TimingReplayPlan;
  readonly arms: readonly TimingArm[];
  /** Fresh, empty store - one per pass. */
  readonly createStore: () => TimingStoreLike;
}

/**
 * Build the `createPass` function the timing loop drives.
 *
 * Each call starts a pass: a fresh store, the arm's overrides, then the
 * untimed preamble. The returned function applies one fix.
 *
 * @throws Error for an unknown arm id; RangeError for a fix index outside the
 *   recording. Both mean the caller and this plan disagree about what is being
 *   measured, which would otherwise surface as a silently wrong column.
 */
export function createPassFactory(
  input: CreatePassFactoryInput
): (armId: string) => (fixIndex: number) => void {
  const byId = new Map(input.arms.map((a) => [a.id, a]));
  return (armId: string) => {
    const arm = byId.get(armId);
    if (!arm) throw new Error(`unknown timing arm "${armId}"`);
    const store = input.createStore();
    // `setAlignmentOverrides` REPLACES rather than merges, and `null` is the
    // shipped configuration - so this one dispatch fully defines the arm.
    store.dispatch(setAlignmentOverrides(arm.overrides));
    for (const action of input.plan.preamble) store.dispatch(action);
    return (fixIndex: number) => {
      const group = input.plan.groups[fixIndex];
      if (!group) {
        throw new RangeError(
          `fix index ${fixIndex} is outside the recording's ${input.plan.fixCount} fixes`
        );
      }
      for (const action of group) store.dispatch(action);
    };
  };
}
