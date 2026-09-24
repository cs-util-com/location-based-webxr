// THROWAWAY C: pure source resolution plus a host-owned lifecycle wrapper.
// No sibling prototype imports. The resolver takes all data explicitly.
import {
  calculateSunPosition, coordinates, epoch, validFix, defaults, storeInputs,
  copyInputs, freezeState, notifications,
  type Inputs, type StoredInputs, type Fix, type GpsPosition, type State,
} from '../shared/contracts.ts';

export interface Snapshot {
  selection: StoredInputs;
  live: Fix | null;
  liveInvalid: boolean;
  realTimeMs?: number;
}

export function resolveSnapshot(snapshot: Snapshot): State {
  const { selection, live, liveInvalid } = snapshot;
  const location = selection.location.mode === 'fixed' ? selection.location
    : live && { mode: 'live' as const, latitudeDeg: live.lat, longitudeDeg: live.lon, recordedAtMs: live.timestamp };
  if (!location) return freezeState(liveInvalid
    ? { status: 'invalid-input', reason: 'location' } : { status: 'waiting-for-location' });
  const { latitudeDeg, longitudeDeg, recordedAtMs } = location;
  if (!coordinates(latitudeDeg, longitudeDeg) || (recordedAtMs !== undefined && !epoch(recordedAtMs))) {
    return freezeState({ status: 'invalid-input', reason: 'location' });
  }
  const ms = selection.time.mode === 'fixed' ? selection.time.ms : snapshot.realTimeMs;
  if (ms === undefined || !epoch(ms)) return freezeState({ status: 'invalid-input', reason: 'time' });
  return freezeState({ status: 'ready', sample: {
    latitudeDeg, longitudeDeg, locationSource: selection.location.mode,
    timeSource: selection.time.mode, locationTimestampMs: recordedAtMs ?? null,
    sunTimeMs: ms, sun: calculateSunPosition(new Date(ms), latitudeDeg, longitudeDeg),
  } });
}

export function createSnapshotHost(now = () => Date.now()) {
  let snapshot: Snapshot = { selection: storeInputs(defaults()), live: null, liveInvalid: false };
  let output: State = resolveSnapshot(snapshot);
  const observers = notifications();
  function refresh(): State {
    if (output.status === 'disposed') return output;
    // Probe only input availability first. The pure resolver cannot read a clock.
    const resolved = resolveSnapshot({ ...snapshot, realTimeMs: undefined });
    output = resolved.status === 'invalid-input' && resolved.reason === 'time'
      && snapshot.selection.time.mode === 'real'
      ? resolveSnapshot({ ...snapshot, realTimeMs: now() }) : resolved;
    observers.run(output);
    return output;
  }
  return {
    replaceSelection(selection: Inputs) {
      if (output.status === 'disposed') return output;
      snapshot = { ...snapshot, selection: storeInputs(selection) };
      return refresh();
    },
    acceptGps(fix: GpsPosition) {
      if (output.status === 'disposed') return output;
      const valid = validFix(fix);
      snapshot = { ...snapshot, liveInvalid: !valid, live: valid
        ? { lat: fix.lat, lon: fix.lon, timestamp: fix.timestamp } : null };
      return snapshot.selection.location.mode === 'live' ? refresh() : output;
    },
    refresh,
    inputs: () => copyInputs(snapshot.selection),
    read: () => output,
    subscribe: (fn: (state: State) => void) => output.status === 'disposed' ? () => {} : observers.register(fn),
    clearLive() {
      if (output.status === 'disposed') return;
      snapshot = { ...snapshot, live: null, liveInvalid: false };
      if (snapshot.selection.location.mode === 'live') refresh();
    },
    dispose() {
      if (output.status === 'disposed') return;
      snapshot = { ...snapshot, live: null };
      output = freezeState({ status: 'disposed' });
      observers.runOnce(output);
    },
  };
}
