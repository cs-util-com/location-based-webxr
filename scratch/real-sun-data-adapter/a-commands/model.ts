// THROWAWAY A: command-oriented closure. No imports from sibling prototypes.
import {
  calculateSunPosition, coordinates, epoch, validFix, defaults, storeInputs,
  copyInputs, freezeState, notifications,
  type Inputs, type Location, type Time, type Fix, type GpsPosition, type State,
} from '../shared/contracts.ts';

export function createCommands(now = () => Date.now()) {
  let selection = storeInputs(defaults());
  let latest: Fix | null = null;
  let liveError = false;
  let state: State = freezeState({ status: 'waiting-for-location' });
  const listeners = notifications();
  const publish = (next: State) => {
    state = freezeState(next);
    listeners.run(state);
    return state;
  };
  function refresh(): State {
    if (state.status === 'disposed') return state;
    const source = selection.location;
    if (source.mode === 'live' && !latest) {
      return publish(liveError ? { status: 'invalid-input', reason: 'location' } : { status: 'waiting-for-location' });
    }
    const lat = source.mode === 'fixed' ? source.latitudeDeg : latest!.lat;
    const lon = source.mode === 'fixed' ? source.longitudeDeg : latest!.lon;
    const timestamp = source.mode === 'fixed' ? source.recordedAtMs ?? null : latest!.timestamp;
    if (!coordinates(lat, lon) || (timestamp !== null && !epoch(timestamp))) {
      return publish({ status: 'invalid-input', reason: 'location' });
    }
    const instant = selection.time.mode === 'fixed' ? selection.time.ms : now();
    if (!epoch(instant)) return publish({ status: 'invalid-input', reason: 'time' });
    return publish({ status: 'ready', sample: {
      latitudeDeg: lat, longitudeDeg: lon, locationTimestampMs: timestamp,
      locationSource: source.mode, timeSource: selection.time.mode,
      sunTimeMs: instant, sun: calculateSunPosition(new Date(instant), lat, lon),
    } });
  }
  function setInputs(inputs: Inputs): State {
    if (state.status === 'disposed') return state;
    selection = storeInputs(inputs);
    return refresh();
  }
  return {
    setInputs,
    setLocationSource(location: Location) { return setInputs({ ...copyInputs(selection), location }); },
    setTimeSource(time: Time) { return setInputs({ ...copyInputs(selection), time }); },
    setGpsPosition(position: GpsPosition) {
      if (state.status === 'disposed') return state;
      liveError = !validFix(position);
      latest = liveError ? null : { lat: position.lat, lon: position.lon, timestamp: position.timestamp };
      return selection.location.mode === 'live' ? refresh() : state;
    },
    refresh,
    getInputs: () => copyInputs(selection),
    getState: () => state,
    subscribe: (fn: (state: State) => void) => state.status === 'disposed' ? () => {} : listeners.register(fn),
    clearLiveLocation() {
      if (state.status === 'disposed') return;
      latest = null; liveError = false;
      if (selection.location.mode === 'live') refresh();
    },
    dispose() {
      if (state.status === 'disposed') return;
      latest = null;
      publish({ status: 'disposed' });
      listeners.clear();
    },
  };
}
