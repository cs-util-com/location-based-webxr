import '../../test-setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTrackerCaptureGate,
  type TrackerCadence,
  type TrackerCaptureGate,
  type TrackerRegistration,
} from './tracker-capture-gate.js';
import {
  createNearbyPositionSource,
  type NearbyGpsEvents,
  type NearbyGpsPoint,
  type NearbyPosition,
} from './nearby-position.js';
import {
  DEFAULT_NEARBY_PARAMS,
  nearbyTargets,
  timeSlot,
  type Target,
} from './nearby-targets.js';
import type * as NearbyTargetsModule from './nearby-targets.js';

// The kernel stays the real one; the spy only counts its calls and keeps
// its inputs, so the cost tests need no hook in the production API.
vi.mock('./nearby-targets.js', async (importOriginal) => {
  const real = await importOriginal<typeof NearbyTargetsModule>();
  return { ...real, nearbyTargets: vi.fn(real.nearbyTargets) };
});

/** A whole second, so every cadence slot starts at a known time. */
const NOW = 1_800_000_000_000;
const INTERVAL = 125;
const QR_CADENCE: TrackerCadence = {
  inGateHz: 8,
  outsideHz: 1,
  unknownHz: 1,
  burstHz: 8,
  burstMs: 10_000,
};

/** A fresh device fix and the live pose, both at (north, east). */
function gpsAt(north: number, east: number, accM = 3): NearbyPosition {
  return {
    fixes: [{ t: NOW - 500, north, east, accM }],
    newestFixAtMs: NOW - 500,
    arPoses: [{ t: NOW - 500, pos: [0, 0, 0], device: true }],
    live: { t: NOW, north, east, ar: [0, 0, 0], accM },
  };
}

const UNKNOWN: NearbyPosition = {
  fixes: [],
  newestFixAtMs: null,
  arPoses: [],
  live: null,
};

function code(key: string, north: number, east: number): Target {
  return { key, kind: 'qr', north, east, accM: 1, reachM: 2 };
}

function qr(over: Partial<TrackerRegistration> = {}): TrackerRegistration {
  return {
    kind: 'qr',
    targets: () => [code('a', 0, 0), code('b', 500, 0)],
    cadence: QR_CADENCE,
    isBusy: () => false,
    lastHitAtMs: () => null,
    forceOn: () => false,
    ...over,
  };
}

function gate(
  position: (nowMs: number) => NearbyPosition,
  k?: number
): TrackerCaptureGate {
  return createTrackerCaptureGate({
    position,
    params: DEFAULT_NEARBY_PARAMS,
    captureIntervalMs: INTERVAL,
    ...(k === undefined ? {} : { k }),
  });
}

/**
 * The camera source's own rule, simulated: asked at 60 Hz, it captures
 * when the gate wants the frame and at least one interval passed since its
 * last capture (a veto does not consume the interval). Returns the capture
 * times.
 */
function captures(
  g: TrackerCaptureGate,
  fromMs: number,
  durationMs: number
): number[] {
  const out: number[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (let t = fromMs; t < fromMs + durationMs; t += 1000 / 60) {
    if (t - last >= INTERVAL && g.wantsFrame(t)) {
      out.push(t);
      last = t;
    }
  }
  return out;
}

beforeEach(() => {
  vi.mocked(nearbyTargets).mockClear();
});

describe('createTrackerCaptureGate: one QR registration', () => {
  // Why this test matters: the whole saving. Inside a code's gate QR keeps
  // today's rate (every capture interval); outside every gate, and with no
  // usable position, it drops to about 1 Hz.
  it('captures at every interval in gate, and at about 1 Hz outside and when unknown', () => {
    const inGate = gate(() => gpsAt(0, 0));
    inGate.register(qr());
    const n = captures(inGate, NOW, 10_000).length;
    expect(n).toBeGreaterThanOrEqual(75);
    expect(n).toBeLessThanOrEqual(80);

    const outside = gate(() => gpsAt(200, 200));
    outside.register(qr());
    expect(captures(outside, NOW, 10_000)).toHaveLength(10);

    const unknown = gate(() => UNKNOWN);
    unknown.register(qr());
    expect(captures(unknown, NOW, 10_000)).toHaveLength(10);
  });

  // Why this test matters: in gate the route names the open codes; with no
  // usable position it names one code per slot, in turn, so each target
  // gets its share of the slow cadence.
  it('routes the open codes in gate, and one code per second in turn when unknown', () => {
    const inGate = gate(() => gpsAt(0, 0));
    inGate.register(qr());
    expect(inGate.kindsFor(NOW)).toEqual([{ kind: 'qr', targetIds: ['a'] }]);

    const unknown = gate(() => UNKNOWN);
    unknown.register(qr());
    const named = new Set<string>();
    for (let s = 0; s < 20; s += 1) {
      const [route] = unknown.kindsFor(NOW + s * 1_000);
      expect(route?.targetIds).toHaveLength(1);
      // The same code for the whole slot.
      expect(unknown.kindsFor(NOW + s * 1_000 + 100)).toEqual([route]);
      named.add(route!.targetIds[0]!);
    }
    expect([...named].sort()).toEqual(['a', 'b']);
    // Between slots, nothing is wanted.
    expect(unknown.kindsFor(NOW + 500)).toEqual([]);
  });

  // Why this test matters: a camera that captures only every second slot
  // (a busy controller, a slow frame rate) must still reach every code in
  // turn; with 4 codes a plain slot count mod 4 would name 2 of them only.
  it('reaches every code in turn when only every second slot is captured', () => {
    const four = ['a', 'b', 'c', 'd'].map((key, i) => code(key, 500 + i, 0));
    const unknown = gate(() => UNKNOWN);
    unknown.register(qr({ targets: () => four }));
    const named = new Set<string>();
    for (let s = 0; s < 60; s += 2) {
      for (const r of unknown.kindsFor(NOW + s * 1_000)) {
        for (const id of r.targetIds) named.add(id);
      }
    }
    expect([...named].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  // Why this test matters: a hit (the tracker's newest decode or
  // detection) opens the full rate for burstMs, so a lock can complete at
  // once; the gate derives it from the tracker's own last hit, so it holds
  // no timer.
  it('a hit opens the full rate for burstMs, then the slow cadence returns', () => {
    const g = gate(() => gpsAt(200, 200));
    g.register(qr({ lastHitAtMs: () => NOW }));
    expect(captures(g, NOW, 10_000).length).toBeGreaterThanOrEqual(75);
    expect(captures(g, NOW + 10_000, 10_000)).toHaveLength(10);
    // A hit in the future (a clock mismatch) opens nothing.
    const future = gate(() => gpsAt(200, 200));
    future.register(qr({ lastHitAtMs: () => NOW + 60_000 }));
    expect(captures(future, NOW, 10_000)).toHaveLength(10);
  });

  // Why this test matters: the force-on setting (and codes-only for QR)
  // keeps the in-gate rate wherever the visitor is.
  it('forceOn() keeps the in-gate rate outside every gate and when unknown', () => {
    for (const position of [gpsAt(200, 200), UNKNOWN]) {
      const g = gate(() => position);
      g.register(qr({ forceOn: () => true }));
      expect(captures(g, NOW, 10_000).length).toBeGreaterThanOrEqual(75);
    }
  });

  // Why this test matters: a busy tracker cannot take a frame; asking for
  // one would only cost the capture.
  it('a busy tracker vetoes every frame, even in gate', () => {
    const g = gate(() => gpsAt(0, 0));
    g.register(qr({ isBusy: () => true, forceOn: () => true }));
    expect(g.wantsFrame(NOW)).toBe(false);
    expect(g.kindsFor(NOW)).toEqual([]);
  });

  // Why this test matters: in the slow rate's slot during a burst both
  // rates want the frame, and the round robin must follow the faster one
  // (the rate the tracker is really capturing at). Taking the first in-slot
  // rate (the 1 Hz base) handed the 8 Hz capture that falls in the base
  // rate's slot the base rate's target: one capture in eight went to the
  // wrong target, so the burst's round robin skipped a beat every second.
  it('a burst outside every gate turns its targets on the burst period', () => {
    const keys = ['a', 'b', 'c', 'd', 'e'];
    const g = gate(() => gpsAt(200, 200));
    g.register(
      qr({
        targets: () => keys.map((key, i) => code(key, 500 + i, 0)),
        lastHitAtMs: () => NOW,
      })
    );
    let differs = 0;
    for (let s = 0; s < 9; s += 1) {
      // Inside the 1 Hz slot, so both the base rate and the burst are in.
      const t = NOW + s * 1_000 + 60;
      const burst = keys[timeSlot(t, INTERVAL, keys.length)]!;
      if (burst !== keys[timeSlot(t, 1_000, keys.length)]) differs += 1;
      expect(g.kindsFor(t)).toEqual([{ kind: 'qr', targetIds: [burst] }]);
    }
    // The case is discriminating: the two periods name different targets.
    expect(differs).toBeGreaterThan(0);
  });

  // Why this test matters: an unregister kept by a caller and called again
  // after the same tracker registered anew must not remove the new
  // registration; the tracker would silently stop getting frames.
  it('a stale unregister does not remove a new registration of the same tracker', () => {
    const g = gate(() => gpsAt(0, 0));
    const tracker = qr();
    const stale = g.register(tracker);
    stale();
    const fresh = g.register(tracker);
    stale();
    expect(g.wantsFrame(NOW)).toBe(true);
    fresh();
    expect(g.wantsFrame(NOW)).toBe(false);
  });

  // Why this test matters: a session's end unregisters its trackers; one
  // left behind would keep asking for frames for a dead pipeline.
  it('unregister removes the tracker', () => {
    const g = gate(() => gpsAt(0, 0));
    const off = g.register(qr());
    expect(g.wantsFrame(NOW)).toBe(true);
    off();
    off();
    expect(g.wantsFrame(NOW)).toBe(false);
  });

  // Why this test matters: a cadence of 0 means off, and a rate at or above
  // the capture rate means every interval; neither divides by zero.
  it('reads 0 Hz as off and a rate above the capture rate as always', () => {
    const off = gate(() => gpsAt(200, 200));
    off.register(qr({ cadence: { ...QR_CADENCE, outsideHz: 0 } }));
    expect(captures(off, NOW, 5_000)).toHaveLength(0);
    const fast = gate(() => gpsAt(200, 200));
    fast.register(qr({ cadence: { ...QR_CADENCE, outsideHz: 60 } }));
    expect(captures(fast, NOW, 5_000).length).toBeGreaterThanOrEqual(38);
  });

  // Why this test matters: bad configuration is a caller bug, refused at
  // once rather than read as some cadence.
  it('refuses bad options, cadences and times', () => {
    expect(() =>
      createTrackerCaptureGate({
        position: () => UNKNOWN,
        captureIntervalMs: 0,
      })
    ).toThrow(RangeError);
    expect(() =>
      createTrackerCaptureGate({
        position: () => UNKNOWN,
        captureIntervalMs: INTERVAL,
        k: 0,
      })
    ).toThrow(RangeError);
    const g = gate(() => UNKNOWN);
    expect(() =>
      g.register(qr({ cadence: { ...QR_CADENCE, inGateHz: -1 } }))
    ).toThrow(RangeError);
    expect(() =>
      g.register(qr({ cadence: { ...QR_CADENCE, burstMs: Number.NaN } }))
    ).toThrow(RangeError);
    g.register(qr());
    expect(() => g.wantsFrame(Number.NaN)).toThrow(RangeError);
  });
});

describe('createTrackerCaptureGate: a second tracker kind', () => {
  /** A fake image tracker: 2 Hz in gate, off outside and when unknown. */
  function image(targets: Target[]): TrackerRegistration {
    return {
      kind: 'image',
      targets: () => targets,
      cadence: {
        inGateHz: 2,
        outsideHz: 0,
        unknownHz: 0,
        burstHz: 2,
        burstMs: 5_000,
      },
      isBusy: () => false,
      lastHitAtMs: () => null,
      forceOn: () => false,
    };
  }
  const posters: Target[] = [1, 2, 3, 4, 5].map((i) => ({
    key: `p${i}`,
    kind: 'image',
    north: i,
    east: 0,
    accM: 1,
    reachM: 2,
  }));

  // Why this test matters: new kinds plug in without a change to the gate.
  // The image tracker gets frames by its own cadence and only its own open
  // targets, capped at k with the nearest always in; QR's decisions are the
  // same with or without it.
  it('routes the image kind by its own cadence and targets, and leaves QR unchanged', () => {
    const alone = gate(() => gpsAt(0, 0));
    alone.register(qr());
    const both = gate(() => gpsAt(0, 0));
    both.register(qr());
    both.register(image(posters));
    for (let t = NOW; t < NOW + 2_000; t += 1000 / 60) {
      const qrAlone = alone.kindsFor(t).filter((r) => r.kind === 'qr');
      const qrBoth = both.kindsFor(t).filter((r) => r.kind === 'qr');
      expect(qrBoth).toEqual(qrAlone);
    }
    // 2 Hz: wanted in the first interval of each half second only.
    const at = (t: number) => both.kindsFor(t).find((r) => r.kind === 'image');
    expect(at(NOW + 100)).toBeDefined();
    expect(at(NOW + 200)).toBeUndefined();
    expect(at(NOW + 510)).toBeDefined();
    // Capped at k = 3: the two nearest always, the third in turn.
    const thirds = new Set<string>();
    for (let t = NOW; t < NOW + 10_000; t += 500) {
      const ids = at(t)!.targetIds;
      expect(ids).toHaveLength(3);
      expect(ids.slice(0, 2)).toEqual(['p1', 'p2']);
      thirds.add(ids[2]!);
    }
    expect([...thirds].sort()).toEqual(['p3', 'p4', 'p5']);
  });

  // Why this test matters: an image tracker is off outside its gates; the
  // QR tracker's slow cadence must not drag it along.
  it('leaves the image kind off outside its gates while QR keeps its slow cadence', () => {
    const g = gate(() => gpsAt(-300, 0));
    g.register(qr());
    g.register(image(posters));
    const kinds = new Set<string>();
    for (let t = NOW; t < NOW + 5_000; t += 1000 / 60) {
      for (const r of g.kindsFor(t)) kinds.add(r.kind);
    }
    expect([...kinds]).toEqual(['qr']);
  });
});

describe('createTrackerCaptureGate: cost, clock-free', () => {
  // Why this test matters: wantsFrame is asked at about 60 Hz while every
  // capture is vetoed; with every tracker busy it must cost nothing, not
  // even the position read.
  it('with every tracker busy, neither the position nor the kernel runs', () => {
    const position = vi.fn(() => gpsAt(0, 0));
    const g = gate(position);
    g.register(qr({ isBusy: () => true }));
    g.register(qr({ kind: 'image', isBusy: () => true }));
    for (let i = 0; i < 100; i += 1) g.wantsFrame(NOW + i);
    expect(position).not.toHaveBeenCalled();
    expect(nearbyTargets).not.toHaveBeenCalled();
  });

  // Stable references, as the store's selectors give: the source is
  // memoised on them.
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const ZERO = { lat: 47, lon: 8 };

  /** A 1 h session of 1 Hz device fixes up to NOW. */
  function hourOfFixes(): NearbyGpsEvents {
    const gpsPositions: NearbyGpsPoint[] = [];
    const odometryPositions: number[][] = [];
    for (let i = 0; i < 3_600; i += 1) {
      gpsPositions.push({
        latitude: 47,
        longitude: 8,
        latLongAccuracy: 4,
        timestamp: NOW - 3_600_000 + (i + 1) * 1_000,
      });
      odometryPositions.push([i * 0.5, 0, 0]);
    }
    return { gpsPositions, odometryPositions };
  }

  // Why this test matters: the position source converts the series once
  // per gpsEvents reference (it changes only per admitted fix), however
  // often the gate asks.
  it('reads the series once per gpsEvents reference', () => {
    const rows = hourOfFixes();
    let reads = 0;
    const counted: NearbyGpsEvents = {
      get gpsPositions() {
        reads += 1;
        return rows.gpsPositions;
      },
      odometryPositions: rows.odometryPositions,
    };
    const source = createNearbyPositionSource({
      gpsEvents: () => counted,
      alignment: () => IDENTITY,
      zero: () => ZERO,
      live: () => null,
      lookBackMs: DEFAULT_NEARBY_PARAMS.H,
    });
    const g = gate((now) => source.position(now));
    g.register(qr());
    for (let i = 0; i < 100; i += 1) g.wantsFrame(NOW + i * 16);
    expect(reads).toBe(1);
  });

  // Why this test matters: the kernel's work is bounded by H, not by the
  // session's length: of 3 600 fixes only the last minute's reach it.
  it('hands the kernel only the samples within H of a 3 600-fix session', () => {
    const rows = hourOfFixes();
    const source = createNearbyPositionSource({
      gpsEvents: () => rows,
      alignment: () => IDENTITY,
      zero: () => ZERO,
      live: () => null,
      lookBackMs: DEFAULT_NEARBY_PARAMS.H,
    });
    const g = gate((now) => source.position(now));
    g.register(qr());
    g.wantsFrame(NOW);
    const input = vi.mocked(nearbyTargets).mock.calls[0]![0];
    expect(input.fixes).toHaveLength(61);
    expect(input.arPoses).toHaveLength(61);
  });
});
