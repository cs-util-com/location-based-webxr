/**
 * Production contract tests, written from docs/real-data-adapter/PLAN.md.
 * No prototype implementations, fixtures or test harnesses are imported.
 *
 * RED: defer the production import until beforeEach so every behavior is
 * collected even while the module is absent. Do not catch that import failure,
 * substitute a test adapter, or skip cases. GREEN must supply the real module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sunCore from './sun-position.js';
import type { SunPositionResult } from './sun-position.js';
import * as gps from '../sensors/gps.js';
import type { GpsPosition } from '../sensors/gps.js';
import type {
  RealSunDataAdapter,
  RealSunDataAdapterOptions,
  RealSunDataState,
  RealSunSample,
  SunInputSelection,
  SunLocationSource,
} from './real-sun-data-adapter.js';

const CURRENT_MS = Date.parse('2026-07-12T10:15:30.000Z');
const FIX_MS = CURRENT_MS - 12_000;
const MANUAL_MS = Date.parse('2026-01-08T22:40:00.000Z');
const LOCATION = { latitudeDeg: 51.05, longitudeDeg: 13.74 };

function makeGps(overrides: Partial<GpsPosition> = {}): GpsPosition {
  return {
    lat: LOCATION.latitudeDeg,
    lon: LOCATION.longitudeDeg,
    timestamp: FIX_MS,
    accuracy: 8,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
    ...overrides,
  };
}

function fixedInputs(instantMs = MANUAL_MS): SunInputSelection {
  return {
    location: { mode: 'fixed', ...LOCATION },
    time: { mode: 'fixed', instant: new Date(instantMs) },
  };
}

function sampleOf(state: RealSunDataState): RealSunSample {
  expect(state.status).toBe('ready');
  if (state.status !== 'ready') {
    throw new Error('Expected a ready sun sample');
  }
  return state.sample;
}

let createRealSunDataAdapter: typeof import('./real-sun-data-adapter.js').createRealSunDataAdapter;
let instances: RealSunDataAdapter[] = [];

function makeAdapter(options?: RealSunDataAdapterOptions): RealSunDataAdapter {
  const adapter = createRealSunDataAdapter(options);
  instances.push(adapter);
  return adapter;
}

beforeEach(async () => {
  instances = [];
  vi.useFakeTimers();
  vi.setSystemTime(CURRENT_MS);
  ({ createRealSunDataAdapter } = await import('./real-sun-data-adapter.js'));
});

afterEach(() => {
  try {
    for (const adapter of instances) {
      adapter.dispose();
    }
  } finally {
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});

describe('createRealSunDataAdapter: live defaults and core delegation', () => {
  it('starts live/real without a fabricated location, clock read or calculation', () => {
    const now = vi.fn(() => CURRENT_MS);
    const calculate = vi.spyOn(sunCore, 'calculateSunPosition');
    const adapter = makeAdapter({ now });

    expect(adapter.getInputs()).toEqual({
      location: { mode: 'live' },
      time: { mode: 'real' },
    });
    expect(adapter.getState()).toEqual({ status: 'waiting-for-location' });
    expect(adapter.refresh()).toEqual({ status: 'waiting-for-location' });
    expect(now).not.toHaveBeenCalled();
    expect(calculate).not.toHaveBeenCalled();
  });

  it('uses current device time by default, keeping GPS fix time as metadata', () => {
    const calculate = vi.spyOn(sunCore, 'calculateSunPosition');
    const adapter = makeAdapter();

    const state = adapter.setGpsPosition(makeGps());

    expect(calculate).toHaveBeenCalledExactlyOnceWith(
      new Date(CURRENT_MS),
      LOCATION.latitudeDeg,
      LOCATION.longitudeDeg
    );
    expect(sampleOf(state)).toMatchObject({
      ...LOCATION,
      locationSource: 'live',
      timeSource: 'real',
      locationTimestampMs: FIX_MS,
      sunTimeMs: CURRENT_MS,
    });
    expect(adapter.getState()).toEqual(state);
  });

  it('reads the injected clock once per live evaluation and passes coordinates in order', () => {
    const now = vi.fn(() => CURRENT_MS + 2000);
    const calculate = vi.spyOn(sunCore, 'calculateSunPosition');
    const adapter = makeAdapter({ now });

    adapter.setGpsPosition(makeGps({ lat: -33.87, lon: 151.21 }));

    expect(now).toHaveBeenCalledTimes(1);
    expect(calculate).toHaveBeenCalledExactlyOnceWith(
      new Date(CURRENT_MS + 2000),
      -33.87,
      151.21
    );
  });

  it('consumes a framework GPS callback alongside the existing host handler', () => {
    const adapter = makeAdapter();
    const existingHandler = vi.fn<(position: GpsPosition) => void>();
    const onGpsPosition = (position: GpsPosition): void => {
      existingHandler(position);
      adapter.setGpsPosition(position);
    };
    const position = makeGps();

    onGpsPosition(position);

    expect(existingHandler).toHaveBeenCalledExactlyOnceWith(position);
    expect(sampleOf(adapter.getState())).toMatchObject(LOCATION);
  });

  it('does not acquire or stop a shared GPS watch or schedule its own refresh', () => {
    const start = vi.spyOn(gps, 'startGpsWatch').mockImplementation(() => {});
    const stop = vi.spyOn(gps, 'stopGpsWatch').mockImplementation(() => {});
    const timerCount = vi.getTimerCount();
    const adapter = makeAdapter();
    expect(vi.getTimerCount()).toBe(timerCount);

    adapter.setGpsPosition(makeGps());
    adapter.setInputs(fixedInputs());
    adapter.clearLiveLocation();
    adapter.refresh();
    expect(vi.getTimerCount()).toBe(timerCount);
    adapter.dispose();

    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(timerCount);
  });

  it.each([
    { name: 'above the horizon', altitudeRad: 0.42, isAboveHorizon: true },
    { name: 'below the horizon', altitudeRad: -0.42, isAboveHorizon: false },
  ])(
    'preserves every SunPositionResult field $name',
    ({ altitudeRad, isAboveHorizon }) => {
      // Opaque sentinel output: the adapter must forward it, not rederive it.
      const result: SunPositionResult = {
        azimuthRad: -1.234,
        altitudeRad,
        directionNue: { x: 0.36, y: -0.48, z: 0.8 },
        isAboveHorizon,
      };
      const calculate = vi
        .spyOn(sunCore, 'calculateSunPosition')
        .mockReturnValue(result);

      const sample = sampleOf(makeAdapter().setInputs(fixedInputs()));

      expect(sample.sun).toEqual(result);
      expect(calculate).toHaveBeenCalledTimes(1);
    }
  );

  it('agrees with the unmocked existing core for a complete absolute input', () => {
    const expected = sunCore.calculateSunPosition(
      new Date(MANUAL_MS),
      LOCATION.latitudeDeg,
      LOCATION.longitudeDeg
    );

    expect(sampleOf(makeAdapter().setInputs(fixedInputs())).sun).toEqual(
      expected
    );
  });

  it('does not disguise unexpected core failures as invalid sensor data', () => {
    const failure = new Error('Unexpected core failure');
    vi.spyOn(sunCore, 'calculateSunPosition').mockImplementation(() => {
      throw failure;
    });

    expect(() => makeAdapter().setInputs(fixedInputs())).toThrow(failure);
  });
});

describe('source selection and independent overrides', () => {
  it.each([
    { locationMode: 'live', timeMode: 'real' },
    { locationMode: 'fixed', timeMode: 'real' },
    { locationMode: 'live', timeMode: 'fixed' },
    { locationMode: 'fixed', timeMode: 'fixed' },
  ] as const)(
    'supports $locationMode location + $timeMode time',
    ({ locationMode, timeMode }) => {
      const now = vi.fn(() => CURRENT_MS);
      const adapter = makeAdapter({ now });
      adapter.setGpsPosition(makeGps());
      now.mockClear();

      const result = adapter.setInputs({
        location:
          locationMode === 'live'
            ? { mode: 'live' }
            : { mode: 'fixed', latitudeDeg: -12, longitudeDeg: -77 },
        time:
          timeMode === 'real'
            ? { mode: 'real' }
            : { mode: 'fixed', instant: new Date(MANUAL_MS) },
      });

      expect(sampleOf(result)).toMatchObject({
        latitudeDeg: locationMode === 'live' ? LOCATION.latitudeDeg : -12,
        longitudeDeg: locationMode === 'live' ? LOCATION.longitudeDeg : -77,
        locationSource: locationMode,
        timeSource: timeMode,
        locationTimestampMs: locationMode === 'live' ? FIX_MS : null,
        sunTimeMs: timeMode === 'real' ? CURRENT_MS : MANUAL_MS,
      });
      expect(now).toHaveBeenCalledTimes(timeMode === 'real' ? 1 : 0);
    }
  );

  it('can use fixed location before GPS arrives without inventing a fix timestamp', () => {
    const adapter = makeAdapter();

    const sample = sampleOf(
      adapter.setLocationSource({ mode: 'fixed', ...LOCATION })
    );

    expect(sample).toMatchObject({
      ...LOCATION,
      locationTimestampMs: null,
      timeSource: 'real',
    });
  });

  it('does not let fixed time substitute for missing live location', () => {
    const now = vi.fn(() => CURRENT_MS);
    const calculate = vi.spyOn(sunCore, 'calculateSunPosition');
    const adapter = makeAdapter({ now });

    expect(
      adapter.setTimeSource({ mode: 'fixed', instant: new Date(MANUAL_MS) })
    ).toEqual({ status: 'waiting-for-location' });
    expect(now).not.toHaveBeenCalled();
    expect(calculate).not.toHaveBeenCalled();
    expect(sampleOf(adapter.setGpsPosition(makeGps())).sunTimeMs).toBe(
      MANUAL_MS
    );
  });

  it('preserves fixed time while replacing location and preserves location while returning to real time', () => {
    const adapter = makeAdapter();
    adapter.setInputs(fixedInputs());
    const location: SunLocationSource = {
      mode: 'fixed',
      latitudeDeg: 40.7,
      longitudeDeg: -74,
      recordedAtMs: FIX_MS,
    };

    expect(sampleOf(adapter.setLocationSource(location))).toMatchObject({
      latitudeDeg: 40.7,
      longitudeDeg: -74,
      sunTimeMs: MANUAL_MS,
      timeSource: 'fixed',
    });
    vi.setSystemTime(CURRENT_MS + 60_000);
    expect(sampleOf(adapter.setTimeSource({ mode: 'real' }))).toMatchObject({
      latitudeDeg: 40.7,
      longitudeDeg: -74,
      locationTimestampMs: FIX_MS,
      timeSource: 'real',
      sunTimeMs: CURRENT_MS + 60_000,
    });
    expect(adapter.getInputs()).toEqual({ location, time: { mode: 'real' } });
  });

  it('caches background GPS silently and uses the newest fix when returning live', () => {
    const now = vi.fn(() => CURRENT_MS);
    const adapter = makeAdapter({ now });
    adapter.setGpsPosition(makeGps());
    const fixed = adapter.setInputs(fixedInputs());
    const listener = vi.fn();
    adapter.subscribe(listener);
    const calculate = vi.spyOn(sunCore, 'calculateSunPosition');
    now.mockClear();

    adapter.setGpsPosition(makeGps({ lat: 47, lon: 9 }));
    expect(
      adapter.setGpsPosition(
        makeGps({ lat: 48, lon: 10, timestamp: CURRENT_MS })
      )
    ).toEqual(fixed);
    expect(listener).not.toHaveBeenCalled();
    expect(calculate).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();

    expect(sampleOf(adapter.setLocationSource({ mode: 'live' }))).toMatchObject(
      {
        latitudeDeg: 48,
        longitudeDeg: 10,
        locationTimestampMs: CURRENT_MS,
        timeSource: 'fixed',
        sunTimeMs: MANUAL_MS,
      }
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns to waiting when fixed location is removed without a cached live fix', () => {
    const adapter = makeAdapter();
    adapter.setInputs(fixedInputs());

    expect(adapter.setLocationSource({ mode: 'live' })).toEqual({
      status: 'waiting-for-location',
    });
    expect(adapter.getInputs()).toEqual({
      location: { mode: 'live' },
      time: { mode: 'fixed', instant: new Date(MANUAL_MS) },
    });
  });
});

describe('absolute time, refresh and deterministic replay', () => {
  it('refreshes current time without a new GPS fix and publishes a new sample', () => {
    const adapter = makeAdapter();
    const first = adapter.setGpsPosition(makeGps());
    const listener = vi.fn();
    adapter.subscribe(listener);
    const calculate = vi.spyOn(sunCore, 'calculateSunPosition');
    vi.setSystemTime(CURRENT_MS + 30_000);

    const refreshed = adapter.refresh();

    expect(refreshed).not.toBe(first);
    expect(sampleOf(refreshed)).toMatchObject({
      ...LOCATION,
      locationTimestampMs: FIX_MS,
      sunTimeMs: CURRENT_MS + 30_000,
    });
    expect(sampleOf(first).sunTimeMs).toBe(CURRENT_MS);
    expect(listener).toHaveBeenCalledExactlyOnceWith(refreshed);
    expect(calculate).toHaveBeenCalledTimes(1);
  });

  it('refreshes fixed time without consulting the real clock, even when unchanged', () => {
    const now = vi.fn(() => {
      throw new Error('Fixed mode must not read the clock');
    });
    const adapter = makeAdapter({ now });
    const first = adapter.setInputs(fixedInputs());
    const listener = vi.fn();
    adapter.subscribe(listener);
    const calculate = vi.spyOn(sunCore, 'calculateSunPosition');
    vi.setSystemTime(CURRENT_MS + 86_400_000);

    const second = adapter.refresh();

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(listener).toHaveBeenCalledExactlyOnceWith(second);
    expect(calculate).toHaveBeenCalledExactlyOnceWith(
      new Date(MANUAL_MS),
      LOCATION.latitudeDeg,
      LOCATION.longitudeDeg
    );
    expect(now).not.toHaveBeenCalled();
  });

  it('updates changed GPS coordinates immediately even at the same solar instant', () => {
    const adapter = makeAdapter();
    adapter.setTimeSource({ mode: 'fixed', instant: new Date(MANUAL_MS) });
    adapter.setGpsPosition(makeGps());
    const listener = vi.fn();
    adapter.subscribe(listener);

    const changed = adapter.setGpsPosition(makeGps({ lat: 12, lon: -45 }));

    expect(sampleOf(changed)).toMatchObject({
      latitudeDeg: 12,
      longitudeDeg: -45,
      sunTimeMs: MANUAL_MS,
    });
    expect(listener).toHaveBeenCalledExactlyOnceWith(changed);
  });

  it.each([
    '2026-10-25T01:30:00.000Z',
    '2026-10-25T02:30:00.000+01:00',
    '2026-10-24T21:30:00.000-04:00',
  ])(
    'passes the absolute instant represented by %s without timezone adjustment',
    (iso) => {
      const calculate = vi.spyOn(sunCore, 'calculateSunPosition');
      const instant = new Date(iso);
      const adapter = makeAdapter();

      const state = adapter.setInputs({
        location: { mode: 'fixed', ...LOCATION },
        time: { mode: 'fixed', instant },
      });

      expect(sampleOf(state).sunTimeMs).toBe(
        Date.parse('2026-10-25T01:30:00Z')
      );
      expect(calculate).toHaveBeenCalledExactlyOnceWith(
        new Date('2026-10-25T01:30:00Z'),
        LOCATION.latitudeDeg,
        LOCATION.longitudeDeg
      );
    }
  );

  it('distinguishes repeated local clock readings with different explicit DST offsets', () => {
    const adapter = makeAdapter();
    const first = sampleOf(
      adapter.setInputs({
        location: { mode: 'fixed', ...LOCATION },
        time: { mode: 'fixed', instant: new Date('2026-10-25T02:30:00+02:00') },
      })
    );
    const second = sampleOf(
      adapter.setTimeSource({
        mode: 'fixed',
        instant: new Date('2026-10-25T02:30:00+01:00'),
      })
    );

    expect(second.sunTimeMs - first.sunTimeMs).toBe(3_600_000);
  });

  it('replaces location and time atomically with one coherent publication and calculation', () => {
    const adapter = makeAdapter();
    adapter.setGpsPosition(makeGps());
    const observed: RealSunDataState[] = [];
    const statesDuringNotification: RealSunDataState[] = [];
    const inputsDuringNotification: SunInputSelection[] = [];
    adapter.subscribe((state) => {
      observed.push(state);
      statesDuringNotification.push(adapter.getState());
      inputsDuringNotification.push(adapter.getInputs());
    });
    const pair: SunInputSelection = {
      location: {
        mode: 'fixed',
        latitudeDeg: -41,
        longitudeDeg: 174,
        recordedAtMs: MANUAL_MS - 5000,
      },
      time: { mode: 'fixed', instant: new Date(MANUAL_MS) },
    };
    const calculate = vi.spyOn(sunCore, 'calculateSunPosition');

    const state = adapter.setInputs(pair);

    expect(observed).toEqual([state]);
    expect(statesDuringNotification).toEqual([state]);
    expect(inputsDuringNotification).toEqual([pair]);
    expect(sampleOf(state)).toMatchObject({
      latitudeDeg: -41,
      longitudeDeg: 174,
      locationSource: 'fixed',
      timeSource: 'fixed',
      locationTimestampMs: MANUAL_MS - 5000,
      sunTimeMs: MANUAL_MS,
    });
    expect(calculate).toHaveBeenCalledExactlyOnceWith(
      new Date(MANUAL_MS),
      -41,
      174
    );
  });

  it('replays forward, backward and duplicate pairs identically regardless of wall time', () => {
    // Synthetic data owned by this test, not a Task 1 recording or prototype fixture.
    const pairs: SunInputSelection[] = [
      fixedInputs(MANUAL_MS),
      {
        location: {
          mode: 'fixed',
          latitudeDeg: 35,
          longitudeDeg: -120,
          recordedAtMs: FIX_MS,
        },
        time: { mode: 'fixed', instant: new Date(CURRENT_MS) },
      },
      fixedInputs(MANUAL_MS),
      fixedInputs(MANUAL_MS),
    ];
    const first = makeAdapter({ now: () => 0 });
    const second = makeAdapter({
      now: () => {
        throw new Error('Replay consulted wall time');
      },
    });
    const listener = vi.fn();
    second.subscribe(listener);
    const results = pairs.map((pair) => second.setInputs(pair));

    expect(pairs.map((pair) => first.setInputs(pair))).toEqual(results);
    expect(results[0]).toEqual(results[2]);
    expect(results[2]).toEqual(results[3]);
    expect(listener).toHaveBeenCalledTimes(pairs.length);
  });
});

describe('invalid inputs, availability and boundaries', () => {
  it.each([
    { lat: 0, lon: 0 },
    { lat: -90, lon: -180 },
    { lat: 90, lon: 180 },
    { lat: -90, lon: 180 },
    { lat: 90, lon: -180 },
  ])('accepts both live and fixed coordinates ($lat, $lon)', ({ lat, lon }) => {
    const adapter = makeAdapter();
    expect(
      sampleOf(adapter.setGpsPosition(makeGps({ lat, lon })))
    ).toMatchObject({ latitudeDeg: lat, longitudeDeg: lon });
    expect(
      sampleOf(
        adapter.setLocationSource({
          mode: 'fixed',
          latitudeDeg: lat,
          longitudeDeg: lon,
        })
      )
    ).toMatchObject({ latitudeDeg: lat, longitudeDeg: lon });
  });

  it.each([
    { lat: NaN },
    { lat: Infinity },
    { lat: -Infinity },
    { lat: -90.01 },
    { lat: 90.01 },
    { lon: NaN },
    { lon: Infinity },
    { lon: -Infinity },
    { lon: -180.01 },
    { lon: 180.01 },
    { timestamp: NaN },
    { timestamp: Infinity },
    { timestamp: -Infinity },
    { timestamp: 8.64e15 + 1 },
  ])(
    'invalidates a malformed live fix %o without retaining the old ready sample',
    (overrides) => {
      const adapter = makeAdapter();
      adapter.setGpsPosition(makeGps());
      const calculate = vi.spyOn(sunCore, 'calculateSunPosition');

      expect(adapter.setGpsPosition(makeGps(overrides))).toEqual({
        status: 'invalid-input',
        reason: 'location',
      });
      expect(adapter.refresh()).toEqual({
        status: 'invalid-input',
        reason: 'location',
      });
      expect(calculate).not.toHaveBeenCalled();
      expect(
        sampleOf(adapter.setGpsPosition(makeGps({ lat: 10 }))).latitudeDeg
      ).toBe(10);
    }
  );

  it.each([
    { latitudeDeg: NaN },
    { latitudeDeg: -91 },
    { latitudeDeg: 91 },
    { longitudeDeg: Infinity },
    { longitudeDeg: -181 },
    { longitudeDeg: 181 },
    { recordedAtMs: NaN },
    { recordedAtMs: Infinity },
    { recordedAtMs: -8.64e15 - 1 },
  ])(
    'keeps an invalid fixed selection %o invalid until explicitly replaced',
    (overrides) => {
      const adapter = makeAdapter();
      adapter.setGpsPosition(makeGps());
      const calculate = vi.spyOn(sunCore, 'calculateSunPosition');
      const location: SunLocationSource = {
        mode: 'fixed',
        ...LOCATION,
        ...overrides,
      };

      expect(adapter.setLocationSource(location)).toEqual({
        status: 'invalid-input',
        reason: 'location',
      });
      expect(adapter.getInputs().location).toEqual(location);
      expect(adapter.refresh()).toEqual({
        status: 'invalid-input',
        reason: 'location',
      });
      expect(calculate).not.toHaveBeenCalled();
      expect(adapter.setLocationSource({ mode: 'live' }).status).toBe('ready');
    }
  );

  it('keeps fixed output valid after a bad background fix but exposes the error on return to live', () => {
    const adapter = makeAdapter();
    adapter.setGpsPosition(makeGps());
    const fixed = adapter.setInputs(fixedInputs());
    const listener = vi.fn();
    adapter.subscribe(listener);
    const calculate = vi.spyOn(sunCore, 'calculateSunPosition');

    expect(adapter.setGpsPosition(makeGps({ timestamp: NaN }))).toEqual(fixed);
    expect(listener).not.toHaveBeenCalled();
    expect(calculate).not.toHaveBeenCalled();
    expect(adapter.setLocationSource({ mode: 'live' })).toEqual({
      status: 'invalid-input',
      reason: 'location',
    });
    expect(adapter.setGpsPosition(makeGps()).status).toBe('ready');
  });

  it.each([NaN, Infinity, -Infinity, 8.64e15 + 1])(
    'recovers from invalid real-clock value %s without discarding GPS',
    (invalidMs) => {
      const now = vi.fn(() => invalidMs);
      const adapter = makeAdapter({ now });
      const calculate = vi.spyOn(sunCore, 'calculateSunPosition');

      expect(adapter.setGpsPosition(makeGps())).toEqual({
        status: 'invalid-input',
        reason: 'time',
      });
      expect(calculate).not.toHaveBeenCalled();
      now.mockReturnValue(CURRENT_MS);
      expect(sampleOf(adapter.refresh())).toMatchObject({
        ...LOCATION,
        sunTimeMs: CURRENT_MS,
        locationTimestampMs: FIX_MS,
      });
    }
  );

  it('does not fall back to real time or an older valid instant after an invalid fixed Date', () => {
    const now = vi.fn(() => CURRENT_MS);
    const adapter = makeAdapter({ now });
    adapter.setInputs(fixedInputs());
    const calculate = vi.spyOn(sunCore, 'calculateSunPosition');

    expect(
      adapter.setTimeSource({ mode: 'fixed', instant: new Date(NaN) })
    ).toEqual({ status: 'invalid-input', reason: 'time' });
    expect(adapter.refresh()).toEqual({
      status: 'invalid-input',
      reason: 'time',
    });
    expect(now).not.toHaveBeenCalled();
    expect(calculate).not.toHaveBeenCalled();
    expect(sampleOf(adapter.setTimeSource({ mode: 'real' })).sunTimeMs).toBe(
      CURRENT_MS
    );
  });

  it('reports location unavailability and invalidity before time errors', () => {
    const now = vi.fn(() => NaN);
    const adapter = makeAdapter({ now });

    expect(
      adapter.setTimeSource({ mode: 'fixed', instant: new Date(NaN) })
    ).toEqual({ status: 'waiting-for-location' });
    expect(adapter.setGpsPosition(makeGps({ lon: NaN }))).toEqual({
      status: 'invalid-input',
      reason: 'location',
    });
    expect(adapter.setGpsPosition(makeGps())).toEqual({
      status: 'invalid-input',
      reason: 'time',
    });
    expect(now).not.toHaveBeenCalled();
  });

  it('does not require altitude/heading/speed or impose an undocumented accuracy or age gate', () => {
    const adapter = makeAdapter();
    const oldFix = makeGps({ timestamp: 0, accuracy: 10_000 });

    expect(sampleOf(adapter.setGpsPosition(oldFix))).toMatchObject({
      ...LOCATION,
      locationTimestampMs: 0,
    });
    vi.setSystemTime(CURRENT_MS + 86_400_000);
    expect(adapter.refresh().status).toBe('ready');
  });
});

describe('snapshots and subscriptions', () => {
  it('copies live coordinates and timestamp instead of retaining the input object', () => {
    const position = { ...makeGps() };
    const adapter = makeAdapter();
    adapter.setGpsPosition(position);
    position.lat = -80;
    position.lon = -170;
    position.timestamp = 0;

    expect(sampleOf(adapter.refresh())).toMatchObject({
      ...LOCATION,
      locationTimestampMs: FIX_MS,
    });
  });

  it('snapshots both source setters, including mutable Date values', () => {
    const adapter = makeAdapter();
    const location = {
      mode: 'fixed' as const,
      ...LOCATION,
      recordedAtMs: FIX_MS,
    };
    const instant = new Date(MANUAL_MS);
    adapter.setLocationSource(location);
    adapter.setTimeSource({ mode: 'fixed', instant });
    location.latitudeDeg = -80;
    location.recordedAtMs = 0;
    instant.setTime(0);

    expect(sampleOf(adapter.refresh())).toMatchObject({
      ...LOCATION,
      locationTimestampMs: FIX_MS,
      sunTimeMs: MANUAL_MS,
    });
  });

  it('copies atomic input selections and returns defensive selections with fresh Dates', () => {
    const adapter = makeAdapter();
    const location = { mode: 'fixed' as const, ...LOCATION };
    const instant = new Date(MANUAL_MS);
    adapter.setInputs({ location, time: { mode: 'fixed', instant } });
    location.longitudeDeg = 100;
    instant.setTime(0);
    const copy = adapter.getInputs();
    const anotherCopy = adapter.getInputs();
    expect(copy).not.toBe(anotherCopy);
    if (copy.time.mode !== 'fixed' || anotherCopy.time.mode !== 'fixed')
      throw new Error('Expected fixed time');
    expect(copy.time.instant).not.toBe(anotherCopy.time.instant);
    copy.time.instant.setTime(1);
    if (copy.location.mode === 'fixed') {
      // A frozen defensive copy is also valid; either way internal inputs stay intact.
      Reflect.set(copy.location, 'latitudeDeg', -80);
    }
    expect(anotherCopy.time.instant.getTime()).toBe(MANUAL_MS);

    expect(adapter.getInputs()).toEqual(fixedInputs());
    expect(sampleOf(adapter.refresh())).toMatchObject({
      ...LOCATION,
      sunTimeMs: MANUAL_MS,
    });
  });

  it('freezes every level of a published sample and leaves old snapshots unchanged', () => {
    const adapter = makeAdapter();
    const first = adapter.setInputs(fixedInputs());
    const sample = sampleOf(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(sample)).toBe(true);
    expect(Object.isFrozen(sample.sun)).toBe(true);
    expect(Object.isFrozen(sample.sun.directionNue)).toBe(true);
    expect(Reflect.set(sample.sun.directionNue, 'x', 900)).toBe(false);
    expect(Reflect.set(sample, 'sunTimeMs', 0)).toBe(false);

    adapter.setTimeSource({ mode: 'fixed', instant: new Date(CURRENT_MS) });
    expect(sampleOf(first).sunTimeMs).toBe(MANUAL_MS);
  });

  it('notifies future state transitions after updating getState and supports idempotent unsubscribe', () => {
    const adapter = makeAdapter();
    const observed: RealSunDataState[] = [];
    const stored: RealSunDataState[] = [];
    const unsubscribe = adapter.subscribe((state) => {
      observed.push(state);
      stored.push(adapter.getState());
    });
    expect(observed).toEqual([]);

    adapter.setGpsPosition(makeGps());
    adapter.setGpsPosition(makeGps({ lat: NaN }));
    adapter.clearLiveLocation();
    expect(observed.map((state) => state.status)).toEqual([
      'ready',
      'invalid-input',
      'waiting-for-location',
    ]);
    expect(stored).toEqual(observed);
    unsubscribe();
    unsubscribe();
    adapter.setInputs(fixedInputs());
    expect(observed).toHaveLength(3);
  });

  it('isolates a throwing subscriber so later subscribers still receive updates', () => {
    const adapter = makeAdapter();
    adapter.subscribe(() => {
      throw new Error('Consumer failed');
    });
    const healthy = vi.fn();
    adapter.subscribe(healthy);

    expect(() => adapter.setInputs(fixedInputs())).not.toThrow();
    expect(healthy).toHaveBeenCalledExactlyOnceWith(adapter.getState());
  });

  it('prevents one subscriber from mutating the sample delivered to another', () => {
    const adapter = makeAdapter();
    const writes: boolean[] = [];
    adapter.subscribe((state) => {
      if (state.status === 'ready')
        writes.push(Reflect.set(state.sample, 'latitudeDeg', 99));
    });
    const observer = vi.fn();
    adapter.subscribe(observer);

    adapter.setInputs(fixedInputs());

    expect(writes).toEqual([false]);
    expect(observer).toHaveBeenCalledExactlyOnceWith(adapter.getState());
    expect(sampleOf(adapter.getState()).latitudeDeg).toBe(LOCATION.latitudeDeg);
  });
});

describe('clear, independent instances and disposal', () => {
  it('clears the live fix and its error while preserving the selected fixed time', () => {
    const adapter = makeAdapter();
    adapter.setGpsPosition(makeGps());
    adapter.setTimeSource({ mode: 'fixed', instant: new Date(MANUAL_MS) });
    adapter.setGpsPosition(makeGps({ timestamp: NaN }));

    adapter.clearLiveLocation();

    expect(adapter.getState()).toEqual({ status: 'waiting-for-location' });
    expect(adapter.getInputs().time).toEqual({
      mode: 'fixed',
      instant: new Date(MANUAL_MS),
    });
    expect(adapter.refresh()).toEqual({ status: 'waiting-for-location' });
    expect(sampleOf(adapter.setGpsPosition(makeGps())).sunTimeMs).toBe(
      MANUAL_MS
    );
  });

  it('clears cached live input without disturbing fixed selection or publishing', () => {
    const adapter = makeAdapter();
    adapter.setGpsPosition(makeGps());
    const state = adapter.setInputs(fixedInputs());
    const listener = vi.fn();
    adapter.subscribe(listener);

    adapter.clearLiveLocation();

    expect(adapter.getState()).toEqual(state);
    expect(adapter.getInputs()).toEqual(fixedInputs());
    expect(listener).not.toHaveBeenCalled();
    expect(adapter.setLocationSource({ mode: 'live' })).toEqual({
      status: 'waiting-for-location',
    });
  });

  it('keeps clocks, live caches, source selections and listeners independent between instances', () => {
    const first = makeAdapter({ now: () => CURRENT_MS });
    const second = makeAdapter({ now: () => MANUAL_MS });
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    first.subscribe(firstListener);
    second.subscribe(secondListener);
    first.setGpsPosition(makeGps());
    expect(second.getState()).toEqual({ status: 'waiting-for-location' });
    expect(secondListener).not.toHaveBeenCalled();
    firstListener.mockClear();
    second.setGpsPosition(makeGps({ lat: 20 }));
    first.dispose();

    expect(sampleOf(second.refresh())).toMatchObject({
      latitudeDeg: 20,
      sunTimeMs: MANUAL_MS,
    });
    expect(second.getInputs()).toEqual({
      location: { mode: 'live' },
      time: { mode: 'real' },
    });
    expect(firstListener).toHaveBeenCalledExactlyOnceWith({
      status: 'disposed',
    });
  });

  it('publishes disposed once and makes later commands and subscriptions inert', () => {
    const now = vi.fn(() => CURRENT_MS);
    const adapter = makeAdapter({ now });
    adapter.setInputs(fixedInputs());
    const observer = vi.fn();
    const off = adapter.subscribe(observer);
    const calculate = vi.spyOn(sunCore, 'calculateSunPosition');

    adapter.dispose();
    adapter.dispose();
    const lateObserver = vi.fn();
    const lateOff = adapter.subscribe(lateObserver);
    expect(adapter.setGpsPosition(makeGps())).toEqual({ status: 'disposed' });
    expect(adapter.setInputs(fixedInputs(CURRENT_MS))).toEqual({
      status: 'disposed',
    });
    expect(adapter.setLocationSource({ mode: 'live' })).toEqual({
      status: 'disposed',
    });
    expect(adapter.setTimeSource({ mode: 'real' })).toEqual({
      status: 'disposed',
    });
    expect(adapter.refresh()).toEqual({ status: 'disposed' });
    adapter.clearLiveLocation();
    off();
    off();
    lateOff();
    lateOff();

    expect(observer).toHaveBeenCalledExactlyOnceWith({ status: 'disposed' });
    expect(lateObserver).not.toHaveBeenCalled();
    expect(calculate).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    expect(adapter.getState()).toEqual({ status: 'disposed' });
    expect(adapter.getInputs()).toEqual(fixedInputs());
    const retained = adapter.getInputs();
    if (retained.time.mode !== 'fixed')
      throw new Error('Expected retained fixed time');
    retained.time.instant.setTime(0);
    expect(adapter.getInputs()).toEqual(fixedInputs());
  });

  it('resets a session by dispose-and-recreate rather than inventing a reset API', () => {
    const previous = makeAdapter();
    previous.setGpsPosition(makeGps());
    previous.setInputs(fixedInputs());
    previous.dispose();

    const fresh = makeAdapter();

    expect(fresh.getInputs()).toEqual({
      location: { mode: 'live' },
      time: { mode: 'real' },
    });
    expect(fresh.getState()).toEqual({ status: 'waiting-for-location' });
    expect(sampleOf(fresh.setGpsPosition(makeGps())).sunTimeMs).toBe(
      CURRENT_MS
    );
    expect(previous.getState()).toEqual({ status: 'disposed' });
  });
});
