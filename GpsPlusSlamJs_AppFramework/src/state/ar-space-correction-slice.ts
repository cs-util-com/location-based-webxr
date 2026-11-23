/**
 * `arSpaceCorrection` slice: the raw relocalization observations of an AR
 * session, and the derived selectors that turn them into the correction of
 * every older observation epoch.
 *
 * The state holds RAW data only (camera poses and times as the feed saw
 * them). Every jump `D`, every `Delta(e)` and every composed pose is derived
 * by a memoised selector, never stored or dispatched, so a recording replays
 * the correction from its raw actions alone and a better jump rule changes
 * the result of an old recording without touching its file.
 *
 * Validation lives in the reducer: an invalid payload leaves the state
 * unchanged and logs a warning with the reason. The reducer never throws, so
 * a bad action from the XR frame loop or from an old recording is refused
 * the same way, live and on replay.
 *
 * Sidecar: `ar-space-correction-slice.ts.md`.
 */

import {
  createSelector,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import {
  correctionTrack,
  epochAt,
  jumpTransform,
  type RelocalizationJump,
} from '../ar/ar-space-correction';
import { createLogger } from '../utils/logger';

const log = createLogger('ArSpaceCorrection');

/**
 * Largest accepted `|norm(q) - 1|` of a raw quaternion. WebXR delivers unit
 * quaternions as float32 (about 1e-7 off unit); a JSON round trip of a
 * recording keeps that. 1e-3 accepts both with a wide margin and still
 * refuses a quaternion that is not a rotation at all (a zero, a scaled or a
 * garbled one). The math normalises every accepted quaternion.
 */
export const UNIT_QUATERNION_TOLERANCE = 1e-3;

/** The raw payload of one observation; see {@link RelocalizationJump}. */
export type RelocalizationObservation = RelocalizationJump;

export interface ArSpaceCorrectionState {
  /** Raw observations, `t` non-decreasing; epoch `e` lies before index `e`. */
  readonly observations: readonly RelocalizationObservation[];
}

/** Structural root: any store carrying the slice under its built-in key. */
export interface RootWithArSpaceCorrection {
  readonly arSpaceCorrection?: ArSpaceCorrectionState;
}

const initialState: ArSpaceCorrectionState = { observations: [] };

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

function finiteTuple(v: unknown, length: number): v is number[] {
  return Array.isArray(v) && v.length === length && v.every(isFiniteNumber);
}

/** Why `pose` is not a raw pose, or `null` when it is one. */
function poseProblem(pose: unknown, name: string): string | null {
  if (typeof pose !== 'object' || pose === null) return `${name} missing`;
  const { position, rotation } = pose as Record<string, unknown>;
  if (!finiteTuple(position, 3)) {
    return `${name}.position is not 3 finite numbers`;
  }
  if (!finiteTuple(rotation, 4)) {
    return `${name}.rotation is not 4 finite numbers`;
  }
  if (Math.abs(Math.hypot(...rotation) - 1) > UNIT_QUATERNION_TOLERANCE) {
    return `${name}.rotation is not a unit quaternion`;
  }
  return null;
}

/** Why the times of `o` are not valid after `previousT`, or `null`. */
function timeProblem(
  o: Record<string, unknown>,
  previousT: number | undefined
): string | null {
  if (!isFiniteNumber(o.t) || !isFiniteNumber(o.tLast)) {
    return 't and tLast must be finite numbers';
  }
  if (!(o.tLast < o.t)) return 'tLast must be before t';
  if (previousT !== undefined && o.t < previousT) {
    return 't is earlier than the previous observation';
  }
  if ((o.tPrev !== null) !== (o.prevPose !== null)) {
    return 'tPrev and prevPose must both be present or both null';
  }
  if (o.tPrev === null) return null;
  if (!isFiniteNumber(o.tPrev)) return 'tPrev must be a finite number';
  return o.tPrev < o.tLast ? null : 'tPrev must be before tLast';
}

/** Why `p` is not a valid observation after `previousT`, or `null`. */
function observationProblem(
  p: unknown,
  previousT: number | undefined
): string | null {
  if (typeof p !== 'object' || p === null) return 'payload missing';
  const o = p as Record<string, unknown>;
  return (
    timeProblem(o, previousT) ??
    poseProblem(o.lastPose, 'lastPose') ??
    poseProblem(o.newPose, 'newPose') ??
    (o.prevPose !== null ? poseProblem(o.prevPose, 'prevPose') : null)
  );
}

/**
 * The six observation fields of `o`, nothing else. Anything that is not an
 * object is passed on as it is, for the reducer to refuse with its reason.
 */
function observationFields(
  o: RelocalizationObservation
): RelocalizationObservation {
  if (typeof o !== 'object' || o === null) return o;
  const { t, tLast, lastPose, tPrev, prevPose, newPose } = o;
  return { t, tLast, lastPose, tPrev, prevPose, newPose };
}

const arSpaceCorrectionSlice = createSlice({
  name: 'arSpaceCorrection',
  initialState,
  reducers: {
    /**
     * One relocalization the feed observed: the camera frame switched
     * between `tLast` and `t`. Segmenting (see `segmenting-actions.ts`).
     * The action creator keeps only the six observation fields, so an
     * object that carries more (a feed's own record) never records more.
     */
    relocalizationObserved: {
      reducer(state, action: PayloadAction<RelocalizationObservation>) {
        const last = state.observations[state.observations.length - 1];
        const problem = observationProblem(action.payload, last?.t);
        if (problem !== null) {
          log.warn(`relocalization observation refused: ${problem}`);
          return state;
        }
        return { observations: [...state.observations, action.payload] };
      },
      prepare(observation: RelocalizationObservation) {
        return { payload: observationFields(observation) };
      },
    },
  },
});

export const { relocalizationObserved } = arSpaceCorrectionSlice.actions;
export const arSpaceCorrectionReducer = arSpaceCorrectionSlice.reducer;

const EMPTY_OBSERVATIONS: readonly RelocalizationObservation[] = [];

/** The raw observations, oldest first. */
export const selectArSpaceObservations = (
  state: RootWithArSpaceCorrection
): readonly RelocalizationObservation[] =>
  state.arSpaceCorrection?.observations ?? EMPTY_OBSERVATIONS;

/** The current epoch: the number of observations so far. */
export const selectArSpaceCorrectionEpoch = (
  state: RootWithArSpaceCorrection
): number => selectArSpaceObservations(state).length;

const selectObservationTimes = createSelector(
  [selectArSpaceObservations],
  (observations) => observations.map((o) => o.t)
);

/**
 * The epoch of an item captured at `capturedAt` (XR-clock ms). Throws a
 * `TypeError` for a NaN or non-number time (see `epochAt`).
 */
export const selectArSpaceEpochAt = (
  state: RootWithArSpaceCorrection,
  capturedAt: number
): number => epochAt(selectObservationTimes(state), capturedAt);

/**
 * `Delta(e)` for every epoch `0..n`, in O; `Delta(n)` is the identity.
 * Reference-stable while the observations are unchanged.
 */
export const selectCorrectionTrack = createSelector(
  [selectArSpaceObservations],
  (observations) => correctionTrack(observations.map((o) => jumpTransform(o)))
);
