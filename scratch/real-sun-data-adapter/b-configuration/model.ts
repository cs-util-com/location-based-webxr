// THROWAWAY B: one atomic configuration operation and explicit event reduction.
// Written independently; no command-prototype implementation is imported.
import {
  calculateSunPosition, coordinates, epoch, validFix, defaults, storeInputs,
  copyInputs, freezeState, notifications,
  type Inputs, type StoredInputs, type Fix, type GpsPosition, type State,
} from '../shared/contracts.ts';

type Event = { kind: 'configure'; inputs: Inputs } | { kind: 'gps'; fix: GpsPosition }
  | { kind: 'refresh' | 'clear' | 'dispose' };
interface Model { config: StoredInputs; live: Fix | 'invalid' | null; disposed: boolean }

function reduce(model: Model, event: Event): Model {
  switch (event.kind) {
    case 'configure': return { ...model, config: storeInputs(event.inputs) };
    case 'gps': return { ...model, live: validFix(event.fix)
      ? { lat: event.fix.lat, lon: event.fix.lon, timestamp: event.fix.timestamp } : 'invalid' };
    case 'clear': return { ...model, live: null };
    case 'dispose': return { ...model, disposed: true, live: null };
    case 'refresh': return model;
  }
}

function evaluate(model: Model, now: () => number): State {
  if (model.disposed) return { status: 'disposed' };
  const { location, time } = model.config;
  let point: { latitudeDeg: number; longitudeDeg: number; timestamp: number | null };
  if (location.mode === 'live') {
    if (model.live === null) return { status: 'waiting-for-location' };
    if (model.live === 'invalid') return { status: 'invalid-input', reason: 'location' };
    point = { latitudeDeg: model.live.lat, longitudeDeg: model.live.lon, timestamp: model.live.timestamp };
  } else {
    point = { ...location, timestamp: location.recordedAtMs ?? null };
  }
  if (!coordinates(point.latitudeDeg, point.longitudeDeg) || (point.timestamp !== null && !epoch(point.timestamp))) {
    return { status: 'invalid-input', reason: 'location' };
  }
  const ms = time.mode === 'real' ? now() : time.ms;
  if (!epoch(ms)) return { status: 'invalid-input', reason: 'time' };
  return { status: 'ready', sample: {
    latitudeDeg: point.latitudeDeg, longitudeDeg: point.longitudeDeg,
    locationTimestampMs: point.timestamp, locationSource: location.mode,
    timeSource: time.mode, sunTimeMs: ms,
    sun: calculateSunPosition(new Date(ms), point.latitudeDeg, point.longitudeDeg),
  } };
}

export function createConfiguration(now = () => Date.now()) {
  let model: Model = { config: storeInputs(defaults()), live: null, disposed: false };
  let output = freezeState(evaluate(model, now));
  const events = notifications();
  function dispatch(event: Event): State {
    if (model.disposed) return output;
    model = reduce(model, event);
    if ((event.kind === 'gps' || event.kind === 'clear') && model.config.location.mode === 'fixed') return output;
    output = freezeState(evaluate(model, now));
    events.run(output);
    if (event.kind === 'dispose') events.clear();
    return output;
  }
  return {
    configure: (inputs: Inputs) => dispatch({ kind: 'configure', inputs }),
    ingestGps: (fix: GpsPosition) => dispatch({ kind: 'gps', fix }),
    refresh: () => dispatch({ kind: 'refresh' }),
    clearLive: () => { dispatch({ kind: 'clear' }); },
    dispose: () => { dispatch({ kind: 'dispose' }); },
    read: () => output,
    configuration: () => copyInputs(model.config),
    subscribe: (fn: (state: State) => void) => model.disposed ? () => {} : events.register(fn),
  };
}
