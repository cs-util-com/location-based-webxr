import { beforeAll, describe, expect, it } from "vitest";
import { calcGpsCoords, type LatLong } from "gps-plus-slam-app-framework/core";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { NearbyGpsPoint } from "gps-plus-slam-app-framework/ar/targets/nearby-position";
import {
  DEFAULT_NEARBY_PARAMS,
  nearbyTargets,
} from "gps-plus-slam-app-framework/ar/targets/nearby-targets";
import {
  codeReachM,
  codeTargets,
  createTrackerCaptureWiring,
  newestHitAtMs,
  QR_BURST_MS,
  type QrDetectionsView,
  type TrackerCaptureWiring,
} from "./tracker-capture-wiring.js";

import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

// The library's geo helpers need its licence, which a store activates.
beforeAll(() => {
  createSlamAppStore({ storageBackend: new NullStorageBackend() });
});

const ZERO: LatLong = { lat: 47, lon: 8 };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const INTERVAL = 125;
/** A whole second, so every 1 Hz slot starts at a known time. */
const T0 = 1_800_000_000_000;

function geoAt(north: number, east: number): QrGeoPose {
  const ll = calcGpsCoords(ZERO, [north, 0, east]);
  return { lat: ll.lat, lon: ll.lon, alt: 0, headingDeg: 0 };
}

function level(
  geo?: QrGeoPose,
  quality?: QrLevel["qr"]["mintQuality"],
): QrLevel {
  return {
    version: 1,
    qr: {
      ...(geo === undefined ? {} : { geo }),
      ...(quality === undefined ? {} : { mintQuality: quality }),
    },
  };
}

interface Sample {
  readonly t: number;
  readonly north: number;
  readonly east: number;
  readonly accM: number;
  /** The odometry (odom-NUE) at this sample; default its own spot. */
  readonly odom?: readonly [number, number, number];
  readonly source?: string;
}

/** A clock, a store's worth of inputs, and the wiring over them. */
function rig(o: {
  readonly levels?: ReadonlyMap<string, QrLevel> | null;
  readonly levelIdByText?: ReadonlyMap<string, string>;
  readonly stations?: readonly { geo: QrGeoPose; foundRadiusM: number }[];
  readonly samples?: readonly Sample[];
  readonly alignment?: readonly number[] | null;
  readonly arPose?: { x: number; y: number; z: number } | null;
  readonly codeLinedUp?: boolean;
  readonly forcePref?: boolean;
  readonly codesOnly?: boolean;
}) {
  const clock = { now: T0 };
  const samples = o.samples ?? [];
  const gpsPositions: NearbyGpsPoint[] = samples.map((s) => {
    const ll = calcGpsCoords(ZERO, [s.north, 0, s.east]);
    return {
      latitude: ll.lat,
      longitude: ll.lon,
      latLongAccuracy: s.accM,
      timestamp: s.t,
      ...(s.source === undefined ? {} : { source: s.source }),
    };
  });
  const events = {
    gpsPositions,
    odometryPositions: samples.map((s) => s.odom ?? [s.north, 0, s.east]),
  };
  const state = {
    detections: { markers: {}, frameEpoch: 0 } as QrDetectionsView,
  };
  const levels = o.levels ?? null;
  const levelIdByText = o.levelIdByText ?? new Map<string, string>();
  const stations = o.stations ?? [];
  const alignment = o.alignment ?? null;
  const wiring = createTrackerCaptureWiring({
    now: () => clock.now,
    captureIntervalMs: INTERVAL,
    gpsEvents: () => (samples.length === 0 ? null : events),
    alignment: () => alignment,
    zero: () => ZERO,
    gpsPoints: () => gpsPositions,
    arPose: () =>
      o.arPose === undefined || o.arPose === null
        ? null
        : { position: o.arPose },
    codeLinedUp: () => o.codeLinedUp ?? false,
    levels: () => levels,
    levelIdByText: () => levelIdByText,
    stations: () => stations,
    detections: () => state.detections,
    qrBusy: () => false,
    forcePref: () => o.forcePref ?? false,
    codesOnly: () => o.codesOnly ?? false,
  });
  return { clock, wiring, state };
}

/** The camera source asking at 60 Hz: a frame is taken when the interval
 *  has passed and the wiring wants it (a veto does not use the interval). */
function captures(
  wiring: TrackerCaptureWiring,
  clock: { now: number },
  fromMs: number,
  toMs: number,
): number {
  let last = Number.NEGATIVE_INFINITY;
  let n = 0;
  for (let t = fromMs; t < toMs; t += 1000 / 60) {
    clock.now = t;
    if (t - last >= INTERVAL && wiring.wantsFrame()) {
      last = t;
      n += 1;
    }
  }
  return n;
}

/** Device fixes at `spot`, one per second over [from, to]. */
function fixesAt(
  north: number,
  east: number,
  fromMs: number,
  toMs: number,
  accM = 4,
): Sample[] {
  const out: Sample[] = [];
  for (let t = fromMs; t <= toMs; t += 1000) out.push({ t, north, east, accM });
  return out;
}

const oneCode = () =>
  new Map([["code-a", level(geoAt(0, 0), { gpsAccuracyM: 3 })]]);

describe("tracker capture wiring: frames", () => {
  // Why this test matters: the store keeps odometry in odom-NUE while the
  // live pose is raw WebXR. Mixed frames would turn a visitor standing
  // still at WebXR (200, 0) into a 283 m step, so s_dr would balloon and
  // codes far beyond the gate would open.
  it("a visitor standing still at WebXR (200, 0) between fixes has s_dr = s", () => {
    const fixAt = T0 - 10_000; // older than F: the state is 'dr'
    // odom-NUE of WebXR (200, 0, 0) is [0, 0, 200]: 200 m east.
    const code = (eastM: number) =>
      new Map([["c", level(geoAt(0, eastM), { gpsAccuracyM: 3 })]]);
    const run = (eastM: number) => {
      const { wiring, clock } = rig({
        levels: code(eastM),
        samples: [
          { t: fixAt, north: 0, east: 200, accM: 4, odom: [0, 0, 200] },
        ],
        alignment: IDENTITY,
        arPose: { x: 200, y: 0, z: 0 },
      });
      const position = wiring.position(clock.now);
      const targets = codeTargets({
        levels: code(eastM),
        levelIdByText: new Map(),
        stations: [],
        zero: ZERO,
        detections: { markers: {} },
      });
      return {
        position,
        result: nearbyTargets({
          targets,
          ...position,
          nowMs: clock.now,
          params: DEFAULT_NEARBY_PARAMS,
        }),
      };
    };
    const { position, result } = run(209.1);
    expect(position.live?.ar[0]).toBeCloseTo(0, 9);
    expect(position.live?.ar[2]).toBeCloseTo(200, 9);
    expect(position.arPoses.at(-1)?.pos).toEqual([0, 0, 200]);
    expect(position.live?.east).toBeCloseTo(200, 9);
    // s = hypot(4, 3) = 5: R_enter = 1.5 + 1.5 x 5 = 9 m. At 9.1 m the
    // code is in the band, so it stays closed; any drift would open it.
    expect(result.state).toBe("dr");
    expect(result.open).toEqual([]);
    expect(run(8.9 + 200).result.open.map((o) => o.key)).toEqual(["c"]);
  });

  // Why this test matters: a code's sighting is raw WebXR too; only a
  // sighting of the current AR frame may open it (an earlier frame's
  // position means nothing now).
  it("a sighting is odom-NUE and of the current frame epoch only", () => {
    const detections: QrDetectionsView = {
      frameEpoch: 2,
      markers: {
        "text-a": {
          detections: [
            {
              timestamp: T0 - 10,
              frameEpoch: 2,
              cameraPose: { position: [1, 0, -3] },
            },
            {
              timestamp: T0,
              frameEpoch: 1,
              cameraPose: { position: [9, 9, 9] },
            },
          ],
        },
        "text-b": {
          detections: [
            {
              timestamp: T0,
              frameEpoch: 1,
              cameraPose: { position: [1, 0, 0] },
            },
          ],
        },
      },
    };
    const targets = codeTargets({
      levels: new Map([
        ["a", level(geoAt(0, 0))],
        ["b", level(geoAt(5, 5))],
      ]),
      levelIdByText: new Map([
        ["text-a", "a"],
        ["text-b", "b"],
      ]),
      stations: [],
      zero: ZERO,
      detections,
    });
    const a = targets.find((t) => t.key === "a");
    expect(a?.sighting?.t).toBe(T0 - 10);
    expect(a?.sighting?.pos[0]).toBeCloseTo(3, 9);
    expect(a?.sighting?.pos[2]).toBeCloseTo(1, 9);
    expect(targets.find((t) => t.key === "b")?.sighting).toBeUndefined();
  });
});

describe("tracker capture wiring: capture counts", () => {
  // Why this test matters: the point of the gate. Outside every code's gate
  // QR is captured about once a second, not eight times; inside it the
  // cadence is unchanged.
  it("every code closed: about 1 Hz; a code open: every interval", () => {
    const far = rig({
      levels: oneCode(),
      samples: fixesAt(500, 500, T0, T0 + 10_000),
    });
    expect(captures(far.wiring, far.clock, T0, T0 + 10_000)).toBe(10);
    const near = rig({
      levels: oneCode(),
      samples: fixesAt(2, 0, T0, T0 + 10_000),
    });
    const n = captures(near.wiring, near.clock, T0, T0 + 10_000);
    expect(n).toBeGreaterThanOrEqual(75);
    expect(n).toBeLessThanOrEqual(80);
  });

  // Why this test matters: a code with no saved spot, or a code of another
  // tour, can only be found by reading frames; the 1 Hz slot outside the
  // gates keeps reading them, and each wanted frame goes to QR.
  it("a code without geo and a foreign code are still read outside gates", () => {
    const { wiring, clock } = rig({
      levels: new Map([["no-geo", level()]]),
      samples: fixesAt(500, 500, T0, T0 + 10_000),
    });
    expect(wiring.lastRoutes()).toBeNull();
    let toQr = 0;
    let last = Number.NEGATIVE_INFINITY;
    for (let t = T0; t < T0 + 10_000; t += 1000 / 60) {
      clock.now = t;
      if (t - last >= INTERVAL && wiring.wantsFrame()) {
        last = t;
        if (wiring.lastRoutes()?.some((r) => r.kind === "qr")) toQr += 1;
      }
    }
    expect(toQr).toBe(10);
  });

  // Why this test matters: the burst compares a detection's time with the
  // gate's clock, both epoch ms. A clock mix-up (performance.now against
  // Date.now) would never open the burst, or never close it.
  it("a hit opens full cadence for T = 10 s, then 1 Hz again", () => {
    const { wiring, clock, state } = rig({
      levels: oneCode(),
      samples: fixesAt(500, 500, T0, T0 + 20_000),
    });
    state.detections = {
      frameEpoch: 0,
      markers: {
        foreign: { detections: [{ timestamp: T0 }] },
      },
    };
    const burst = captures(wiring, clock, T0, T0 + QR_BURST_MS);
    expect(burst).toBeGreaterThanOrEqual(75);
    expect(burst).toBeLessThanOrEqual(80);
    expect(captures(wiring, clock, T0 + QR_BURST_MS, T0 + 20_000)).toBe(10);
  });

  // Why this test matters: the visitor's setting keeps QR at full cadence
  // everywhere, whatever the position says.
  it("the force-on setting: every interval with every code closed", () => {
    const { wiring, clock } = rig({
      levels: oneCode(),
      samples: fixesAt(500, 500, T0, T0 + 10_000),
      forcePref: true,
    });
    expect(captures(wiring, clock, T0, T0 + 10_000)).toBeGreaterThanOrEqual(75);
  });
});

describe("tracker capture wiring: codes-only", () => {
  // Why this test matters: a codes-only visitor gets no fix, so the kernel
  // stays 'unknown' all session; detection is all there is, so QR must not
  // drop to 1 Hz before the first lock.
  it("no lock yet: a frame every interval", () => {
    const { wiring, clock } = rig({ levels: oneCode(), codesOnly: true });
    expect(captures(wiring, clock, T0, T0 + 10_000)).toBeGreaterThanOrEqual(75);
  });

  // Why this test matters: after a code hold ends the precision reads
  // 'none' while the series holds only the code's votes (at its corners,
  // not at the visitor): still a frame every interval.
  it("after the code hold ends (precision 'none'): a frame every interval", () => {
    const votes: Sample[] = [0, 1, 2, 3].map((i) => ({
      t: T0 - 20_000,
      north: i * 0.1,
      east: 0,
      accM: 1,
      source: "synthetic-qr",
    }));
    const { wiring, clock } = rig({
      levels: oneCode(),
      samples: votes,
      alignment: IDENTITY,
      arPose: { x: 0, y: 0, z: 0 },
      codeLinedUp: false,
      codesOnly: true,
    });
    expect(wiring.position(T0).live?.accM).toBeNull();
    expect(captures(wiring, clock, T0, T0 + 10_000)).toBeGreaterThanOrEqual(75);
  });
});

describe("tracker capture wiring: targets", () => {
  // Why this test matters: a code need not stand at its station's centre;
  // its reach must cover the station's found radius from the code's spot,
  // or a visitor at the station would be outside the code's gate.
  it("reach: found radius plus the code-to-station distance plus 1.5 m", () => {
    const code = geoAt(0, 0);
    const station = { geo: geoAt(10, 0), foundRadiusM: 5 };
    expect(codeReachM(code, [station], [])).toBeCloseTo(16.5, 6);
    // A station nearer another code belongs to that code.
    expect(codeReachM(code, [station], [geoAt(12, 0)])).toBeCloseTo(1.5, 6);
    expect(codeReachM(code, [], [])).toBe(1.5);
    // Beyond the code's reach (40 m): not its station.
    expect(
      codeReachM(code, [{ geo: geoAt(60, 0), foundRadiusM: 5 }], []),
    ).toBeCloseTo(1.5, 6);
  });

  // Why this test matters: a heading-uncertain mint's spot may be off by
  // about its alignment's GPS extent: its target carries that extent for
  // the kernel to widen by; a certain mint, or one without an extent,
  // carries none.
  it("a heading-uncertain mint's target carries its alignment's GPS extent", () => {
    const levels = new Map([
      [
        "u",
        level(geoAt(0, 0), {
          gpsAccuracyM: 3,
          alignmentGpsExtentM: 6,
          headingUncertain: true,
        }),
      ],
      ["s", level(geoAt(0, 0), { gpsAccuracyM: 3, headingUncertain: false })],
      ["n", level(geoAt(0, 0))],
    ]);
    levels.set(
      "x",
      level(geoAt(0, 0), {
        gpsAccuracyM: 3,
        alignmentGpsExtentM: -1,
        headingUncertain: true,
      }),
    );
    const targets = codeTargets({
      levels,
      levelIdByText: new Map(),
      stations: [],
      zero: ZERO,
      detections: { markers: {} },
    }).map((t) => [t.key, t.accM, t.alignmentGpsExtentM]);
    expect(targets).toEqual([
      ["u", 3, 6],
      ["s", 3, undefined],
      ["n", null, undefined],
      ["x", 3, undefined],
    ]);
  });

  // Why this test matters: the burst reads the newest hit of ANY code, a
  // foreign one included, and nothing for an empty or malformed history.
  it("the newest hit is the newest detection of any code", () => {
    expect(newestHitAtMs({ markers: {} })).toBeNull();
    expect(
      newestHitAtMs({
        markers: {
          a: { detections: [{ timestamp: 5 }, { timestamp: 7 }] },
          b: { detections: [{ timestamp: 9 }] },
          c: { detections: [] },
          d: { detections: [{ timestamp: Number.NaN }] },
        },
      }),
    ).toBe(9);
  });

  // Why this test matters: before the tour's codes are read there is
  // nothing to gate on, and no zero means no spot (sighting only).
  it("no levels: no targets; no zero: no spot", () => {
    const base = {
      levelIdByText: new Map<string, string>(),
      stations: [],
      detections: { markers: {} },
    };
    expect(codeTargets({ ...base, levels: null, zero: ZERO })).toEqual([]);
    const [t] = codeTargets({ ...base, levels: oneCode(), zero: null });
    expect(t?.north).toBeNaN();
  });
});
