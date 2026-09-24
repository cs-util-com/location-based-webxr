// Throwaway acceptance checks shared unchanged by all three variants.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as core from '../../../GpsPlusSlamJs_AppFramework/src/geo/sun-position.ts';
import { createDriver, variants } from '../shared/drivers.ts';
import { defaults, storeInputs, type Inputs, type State } from '../shared/contracts.ts';
import { recordedPair, startMs, syntheticFix } from '../shared/fixtures.ts';
import { resolveSnapshot } from '../c-snapshot/model.ts';

afterEach(() => vi.restoreAllMocks());
function ready(state: State) {
  expect(state.status).toBe('ready');
  if (state.status !== 'ready') throw new Error('Expected ready');
  return state.sample;
}

describe.each(variants)('prototype %s', (variant) => {
  it('defaults to live/real and waits without reading the clock or core', () => {
    const now = vi.fn(() => startMs);
    const calculate = vi.spyOn(core, 'calculateSunPosition');
    const model = createDriver(variant, now);
    expect(model.getInputs()).toEqual(defaults());
    expect(model.refresh()).toEqual({ status: 'waiting-for-location' });
    expect(now).not.toHaveBeenCalled(); expect(calculate).not.toHaveBeenCalled();
  });
  it('delegates once with exact selected inputs and preserves core output', () => {
    const fix = syntheticFix();
    const expected = core.calculateSunPosition(new Date(startMs), fix.lat, fix.lon);
    const calculate = vi.spyOn(core, 'calculateSunPosition');
    const now = vi.fn(() => startMs);
    const model = createDriver(variant, now);
    const sample = ready(model.setGpsPosition(fix));
    expect(calculate).toHaveBeenCalledExactlyOnceWith(new Date(startMs), fix.lat, fix.lon);
    expect(now).toHaveBeenCalledTimes(1);
    expect(sample.sun).toEqual(expected);
    expect(sample.sun.isAboveHorizon).toBe(false);
    expect(sample.locationTimestampMs).toBe(fix.timestamp);
    expect(sample.sunTimeMs).toBe(startMs);
  });
  it.each([['live', 'real'], ['fixed', 'real'], ['live', 'fixed'], ['fixed', 'fixed']] as const)(
    'resolves %s location + %s time', (locationMode, timeMode) => {
      const now = vi.fn(() => startMs);
      const model = createDriver(variant, now);
      model.setGpsPosition(syntheticFix()); now.mockClear();
      const sample = ready(model.setInputs({
        location: locationMode === 'live' ? { mode: 'live' } : { mode: 'fixed', latitudeDeg: 0, longitudeDeg: 0 },
        time: timeMode === 'real' ? { mode: 'real' } : { mode: 'fixed', instant: new Date(startMs + 1000) },
      }));
      expect(sample.locationSource).toBe(locationMode); expect(sample.timeSource).toBe(timeMode);
      expect(sample.latitudeDeg).toBe(locationMode === 'live' ? syntheticFix().lat : 0);
      expect(sample.sunTimeMs).toBe(startMs + (timeMode === 'fixed' ? 1000 : 0));
      expect(now).toHaveBeenCalledTimes(timeMode === 'real' ? 1 : 0);
    });
  it('switches sources independently and uses background fixes when returning live', () => {
    let clock = startMs;
    const model = createDriver(variant, () => clock);
    model.setInputs(recordedPair(0));
    const listener = vi.fn(); model.subscribe(listener);
    const prior = model.getState(); model.setGpsPosition(syntheticFix(1));
    expect(model.getState()).toBe(prior); expect(listener).not.toHaveBeenCalled();
    let sample = ready(model.setLocationSource({ mode: 'live' }));
    expect(sample.latitudeDeg).toBe(syntheticFix(1).lat); expect(sample.timeSource).toBe('fixed');
    clock += 5000; sample = ready(model.setTimeSource({ mode: 'real' }));
    expect(sample.sunTimeMs).toBe(clock); expect(sample.locationSource).toBe('live');
    sample = ready(model.setLocationSource({ mode: 'fixed', latitudeDeg: 0, longitudeDeg: 0 }));
    expect(sample.timeSource).toBe('real'); expect(sample.locationTimestampMs).toBeNull();
  });
  it('refreshes real time without movement; fixed time does not read the clock', () => {
    let clock = startMs;
    const now = vi.fn(() => clock);
    const model = createDriver(variant, now);
    model.setGpsPosition(syntheticFix()); clock += 3600000;
    expect(ready(model.refresh()).sunTimeMs).toBe(clock);
    model.setTimeSource({ mode: 'fixed', instant: new Date(startMs) }); now.mockClear();
    clock += 3600000;
    expect(ready(model.refresh()).sunTimeMs).toBe(startMs);
    expect(now).not.toHaveBeenCalled();
  });
  it('publishes exactly once per atomic forward/backward/repeated recorded pair', () => {
    const now = vi.fn(() => { throw new Error('Replay read real clock'); });
    const model = createDriver(variant, now);
    const publications: State[] = []; model.subscribe((state) => publications.push(state));
    const calculate = vi.spyOn(core, 'calculateSunPosition');
    const sequence = [0, 1, 2, 1, 1, 0];
    sequence.forEach((index, i) => {
      const pair = recordedPair(index);
      model.setInputs(pair);
      expect(publications).toHaveLength(i + 1);
      const sample = ready(publications[i]!);
      if (pair.location.mode !== 'fixed' || pair.time.mode !== 'fixed') throw new Error('fixture');
      expect(sample.latitudeDeg).toBe(pair.location.latitudeDeg);
      expect(sample.sunTimeMs).toBe(pair.time.instant.getTime());
    });
    expect(calculate).toHaveBeenCalledTimes(sequence.length);
    expect(now).not.toHaveBeenCalled();
    expect(publications[0]).toEqual(publications[5]);
    expect(publications[3]).toEqual(publications[4]);
  });
  it('repeats synthetic replay identically under different wall clocks', () => {
    const replay = (clock: number) => {
      const model = createDriver(variant, () => clock);
      return [0, 2, 1, 0].map((index) => model.setInputs(recordedPair(index)));
    };
    expect(replay(0)).toEqual(replay(startMs));
  });
  it('snapshots Date, location and returned selections', () => {
    const selection = recordedPair(0);
    const model = createDriver(variant);
    const before = model.setInputs(selection);
    if (selection.time.mode === 'fixed') selection.time.instant.setTime(0);
    if (selection.location.mode === 'fixed') selection.location.latitudeDeg = 80;
    const copy = model.getInputs();
    if (copy.time.mode === 'fixed') copy.time.instant.setTime(1);
    if (copy.location.mode === 'fixed') copy.location.longitudeDeg = -90;
    expect(model.refresh()).toEqual(before);
    const sample = ready(before);
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(sample.sun.directionNue)).toBe(true);
    expect(() => Object.assign(sample.sun.directionNue, { x: 17 })).toThrow();
  });
  it('snapshots live fixes and accepts missing auxiliary fields', () => {
    const model = createDriver(variant, () => startMs);
    const fix = { ...syntheticFix() };
    model.setGpsPosition(fix); fix.lat = 0;
    expect(ready(model.refresh()).latitudeDeg).toBe(syntheticFix().lat);
  });
  it('equivalent ISO offsets represent the same absolute instant', () => {
    const model = createDriver(variant);
    model.setLocationSource({ mode: 'fixed', latitudeDeg: 0, longitudeDeg: 0 });
    const utc = model.setTimeSource({ mode: 'fixed', instant: new Date('2026-06-21T12:00:00Z') });
    expect(model.setTimeSource({ mode: 'fixed', instant: new Date('2026-06-21T14:00:00+02:00') })).toEqual(utc);
  });
  it.each([NaN, Infinity, 91])('rejects invalid latitude %s without core calls or fallback', (latitudeDeg) => {
    const model = createDriver(variant);
    model.setInputs(recordedPair(0));
    const calculate = vi.spyOn(core, 'calculateSunPosition');
    expect(model.setLocationSource({ mode: 'fixed', latitudeDeg, longitudeDeg: 0 }))
      .toEqual({ status: 'invalid-input', reason: 'location' });
    expect(model.refresh()).toEqual({ status: 'invalid-input', reason: 'location' });
    expect(calculate).not.toHaveBeenCalled();
    expect(model.setInputs(recordedPair(0)).status).toBe('ready');
  });
  it('validates longitude, timestamp, fixed time and location-before-time precedence', () => {
    const model = createDriver(variant, () => NaN);
    expect(model.setLocationSource({ mode: 'fixed', latitudeDeg: 0, longitudeDeg: 181 }))
      .toEqual({ status: 'invalid-input', reason: 'location' });
    expect(model.setInputs({ location: { mode: 'fixed', latitudeDeg: 0, longitudeDeg: 0, recordedAtMs: 9e15 },
      time: { mode: 'fixed', instant: new Date(NaN) } })).toEqual({ status: 'invalid-input', reason: 'location' });
    expect(model.setLocationSource({ mode: 'fixed', latitudeDeg: 0, longitudeDeg: 0 }))
      .toEqual({ status: 'invalid-input', reason: 'time' });
    expect(model.refresh()).toEqual({ status: 'invalid-input', reason: 'time' });
    expect(model.setInputs(recordedPair(0)).status).toBe('ready');
  });
  it('accepts coordinate boundaries and rejects invalid live timestamp', () => {
    const model = createDriver(variant, () => startMs);
    expect(model.setGpsPosition({ ...syntheticFix(), timestamp: NaN }))
      .toEqual({ status: 'invalid-input', reason: 'location' });
    expect(model.setGpsPosition({ ...syntheticFix(), lat: -90, lon: 180 }).status).toBe('ready');
    expect(model.setGpsPosition({ ...syntheticFix(), lat: 90, lon: -180 }).status).toBe('ready');
  });
  it('does not resurrect invalid live fixes; background errors leave fixed state intact', () => {
    const model = createDriver(variant, () => startMs);
    model.setGpsPosition(syntheticFix()); model.setInputs(recordedPair(0));
    const fixed = model.getState(); const listener = vi.fn(); model.subscribe(listener);
    model.setGpsPosition({ ...syntheticFix(), lon: Infinity });
    expect(model.getState()).toBe(fixed); expect(listener).not.toHaveBeenCalled();
    expect(model.setLocationSource({ mode: 'live' })).toEqual({ status: 'invalid-input', reason: 'location' });
    expect(model.refresh()).toEqual({ status: 'invalid-input', reason: 'location' });
    model.clearLiveLocation(); expect(model.getState()).toEqual({ status: 'waiting-for-location' });
    expect(model.setGpsPosition(syntheticFix()).status).toBe('ready');
  });
  it('recovers a real clock error without losing location', () => {
    let ms = NaN;
    const model = createDriver(variant, () => ms);
    expect(model.setGpsPosition(syntheticFix())).toEqual({ status: 'invalid-input', reason: 'time' });
    ms = startMs; expect(ready(model.refresh()).latitudeDeg).toBe(syntheticFix().lat);
  });
  it('clears only live input, retains fixed mode, and isolates instances', () => {
    const a = createDriver(variant, () => startMs), b = createDriver(variant, () => startMs);
    a.setGpsPosition(syntheticFix()); a.setInputs(recordedPair(0));
    const previous = a.getState(); a.clearLiveLocation(); expect(a.getState()).toBe(previous);
    expect(a.setLocationSource({ mode: 'live' })).toEqual({ status: 'waiting-for-location' });
    expect(b.getState()).toEqual({ status: 'waiting-for-location' });
  });
  it('isolates listeners, unsubscribes and disposes idempotently', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const model = createDriver(variant, () => startMs);
    model.subscribe(() => { throw new Error('consumer'); });
    const listener = vi.fn(); const off = model.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
    model.setInputs(recordedPair(0)); expect(listener).toHaveBeenCalledTimes(1);
    off(); off(); model.refresh(); expect(listener).toHaveBeenCalledTimes(1);
    const disposed = vi.fn(); model.subscribe(disposed);
    const selection = model.getInputs();
    model.dispose(); model.dispose(); model.setInputs(defaults()); model.setGpsPosition(syntheticFix());
    model.clearLiveLocation(); model.refresh(); model.subscribe(listener);
    expect(disposed).toHaveBeenCalledExactlyOnceWith({ status: 'disposed' });
    expect(model.getState()).toEqual({ status: 'disposed' });
    expect(model.getInputs()).toEqual(selection);
  });
  it('can consume the same framework-shaped callback as another host handler', () => {
    const model = createDriver(variant, () => startMs);
    const existingHandler = vi.fn();
    const onGpsPosition = (fix: ReturnType<typeof syntheticFix>) => {
      existingHandler(fix); model.setGpsPosition(fix);
    };
    const fix = syntheticFix(); onGpsPosition(fix);
    expect(existingHandler).toHaveBeenCalledExactlyOnceWith(fix);
    expect(ready(model.getState()).latitudeDeg).toBe(fix.lat);
  });
});

it('C resolves a complete snapshot without host state or a clock dependency', () => {
  const selection: Inputs = recordedPair(0);
  const snapshot = { selection: storeInputs(selection), live: null, liveInvalid: false };
  expect(resolveSnapshot(snapshot)).toEqual(resolveSnapshot(snapshot));
  expect(resolveSnapshot(snapshot).status).toBe('ready');
});
