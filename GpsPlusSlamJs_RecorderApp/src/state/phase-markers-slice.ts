/**
 * `phaseMarkers` slice: numbered, timestamped phase markers a walker drops
 * into a recording with one tap ("I am at the hold step now", "stepping to
 * 2 m", "starting the circle"), so the offline analysis reads the protocol
 * phases from the recording instead of guessing them from the pose track.
 *
 * A marker is an annotation and nothing else. It is NOT a reference point:
 * it carries no GPS fix and no pose, and nothing in alignment or fusion
 * reads it. The persisted action is the record; the state exists so the
 * recorder can number the next tap and count the markers in the summary.
 *
 * The rule the reducer enforces: numbers are integers, start at 1 and are
 * strictly increasing; the timestamp is finite, non-negative epoch ms. Any
 * other `phaseMarked` (a duplicate, a malformed action read from a zip) is
 * ignored rather than thrown, so a replay never stops on it.
 *
 * @see phase-markers-slice.ts.md
 */

import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';

export interface PhaseMarker {
  /** Running number within the recording: 1, 2, 3, ... */
  number: number;
  /** When the tap happened, epoch ms (the domain of every recorded action). */
  timestamp: number;
}

export interface PhaseMarkersState {
  markers: PhaseMarker[];
}

const initialState: PhaseMarkersState = { markers: [] };

function isAcceptable(
  state: PhaseMarkersState,
  payload: PhaseMarker | undefined
): payload is PhaseMarker {
  if (typeof payload !== 'object' || payload === null) return false;
  const { number, timestamp } = payload;
  if (!Number.isInteger(number) || number < 1) return false;
  if (!Number.isFinite(timestamp) || timestamp < 0) return false;
  const last = state.markers.at(-1);
  return last === undefined || number > last.number;
}

const phaseMarkersSlice = createSlice({
  name: 'phaseMarkers',
  initialState,
  reducers: {
    phaseMarked(state, action: PayloadAction<PhaseMarker>) {
      const payload = action.payload as PhaseMarker | undefined;
      if (!isAcceptable(state, payload)) return;
      state.markers.push({
        number: payload.number,
        timestamp: payload.timestamp,
      });
    },
  },
});

export const { phaseMarked } = phaseMarkersSlice.actions;
export const phaseMarkersReducer = phaseMarkersSlice.reducer;

const EMPTY: readonly PhaseMarker[] = Object.freeze([]);

/** The markers in recording order; a missing slice reads as none. */
export function selectPhaseMarkers(state: {
  phaseMarkers?: PhaseMarkersState;
}): readonly PhaseMarker[] {
  return state.phaseMarkers?.markers ?? EMPTY;
}

export function selectPhaseMarkerCount(state: {
  phaseMarkers?: PhaseMarkersState;
}): number {
  return selectPhaseMarkers(state).length;
}

/** The number the next tap gets: one past the last marker, 1 for the first. */
export function selectNextPhaseMarkerNumber(state: {
  phaseMarkers?: PhaseMarkersState;
}): number {
  return (selectPhaseMarkers(state).at(-1)?.number ?? 0) + 1;
}
