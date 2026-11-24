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
  stampDecodes,
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
  /** The page's alignment readiness; default: an alignment is given. */
  readonly alignmentReady?: boolean;
  readonly arPose?: { x: number; y: number; z: number } | null;
  readonly codeLinedUp?: boolean;
  readonly forcePref?: boolean;
  readonly codesOnly?: boolean;
  readonly scanning?: boolean;
  /** Whether a code's text opens the burst; default every text. */
  readonly opensBurst?: (text: string) => boolean;
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
    /** The newest decode (epoch ms), lock or not. */
    decodeAtMs: null as number | null,
    stations: o.stations ?? [],
  };
  const levels = o.levels ?? null;
  const levelIdByText = o.levelIdByText ?? new Map<string, string>();
  const alignment = o.alignment ?? null;
  const wiring = createTrackerCaptureWiring({
    now: () => clock.now,
    captureIntervalMs: INTERVAL,
    gpsEvents: () => (samples.length === 0 ? null : events),
    alignment: () => alignment,
    alignmentReady: () => o.alignmentReady ?? alignment !== null,
    zero: () => ZERO,
    gpsPoints: () => gpsPositions,
    arPose: () =>
      o.arPose === undefined || o.arPose === null
        ? null
        : { position: o.arPose },
    codeLinedUp: () => o.codeLinedUp ?? false,
    levels: () => levels,
    levelIdByText: () => levelIdByText,
    stations: () => state.stations,
    detections: () => state.detections,
    lastDecodeAtMs: () => state.decodeAtMs,
    qrBusy: () => false,
    forcePref: () => o.forcePref ?? false,
    codesOnly: () => o.codesOnly ?? false,
    scanning: () => o.scanning ?? false,
    opensBurst: (text) => o.opensBurst?.(text) ?? true,
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

/** The kernel over the wiring's position and the rig's codes. */
function judge(
  wiring: TrackerCaptureWiring,
  nowMs: number,
  input: Omit<Parameters<typeof codeTargets>[0], "zero" | "stations"> & {
    readonly stations?: Parameters<typeof codeTargets>[0]["stations"];
  },
) {
  return nearbyTargets({
    targets: codeTargets({ stations: [], zero: ZERO, ...input }),
    ...wiring.position(nowMs),
    nowMs,
    params: DEFAULT_NEARBY_PARAMS,
  });
}

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

  // Why this test matters: the store's alignment is the identity from the
  // first fix, long before any solve. Used as a real alignment it would
  // place the camera at its raw AR position and open a code the visitor is
  // nowhere near; until the page calls the alignment ready the gate must
  // judge by the lone fix, as the station guide does.
  it("an identity alignment before the alignment is ready gives the lone-fix path", () => {
    const run = (alignmentReady: boolean) => {
      const { wiring, clock } = rig({
        levels: oneCode(),
        // Fixes 700 m off, while the raw odometry and the camera sit at
        // the code's spot.
        samples: fixesAt(500, 500, T0 - 3_000, T0).map((s) => ({
          ...s,
          odom: [0, 0, 0] as const,
        })),
        alignment: IDENTITY,
        alignmentReady,
        arPose: { x: 0, y: 0, z: 0 },
      });
      return {
        live: wiring.position(clock.now).live,
        open: judge(wiring, clock.now, {
          levels: oneCode(),
          levelIdByText: new Map(),
          detections: { markers: {} },
        }).open,
      };
    };
    const before = run(false);
    expect(before.live).toBeNull();
    expect(before.open).toEqual([]);
    // Once ready, the same inputs read as aligned (the control).
    expect(run(true).open.map((o) => o.key)).toEqual(["code-a"]);
  });

  // Why this test matters: the live pose needs a ready alignment, so
  // before it the AR gate and 'dr' are off even though both work in
  // odom-NUE: a code just read stays at the slow rate once the burst ends,
  // and a fix gap reads 'unknown'. Pinned so the sidecar's statement of it
  // stays true, and the ready case shows both come back.
  it("before the alignment is ready there is no live pose: no AR gate, no 'dr'", () => {
    const levels = new Map([["c", level()]]);
    const levelIdByText = new Map([["text-c", "c"]]);
    const detections: QrDetectionsView = {
      frameEpoch: 0,
      markers: {
        "text-c": {
          detections: [
            { timestamp: T0 - 20_000, cameraPose: { position: [0, 0, 0] } },
          ],
        },
      },
    };
    const run = (alignmentReady: boolean) => {
      const { wiring, clock } = rig({
        levels,
        levelIdByText,
        // The newest fix is older than F: 'dr' at best.
        samples: [{ t: T0 - 10_000, north: 0, east: 0, accM: 4 }],
        alignment: IDENTITY,
        alignmentReady,
        arPose: { x: 0, y: 0, z: 0 },
      });
      return {
        live: wiring.position(clock.now).live,
        result: judge(wiring, clock.now, {
          levels,
          levelIdByText,
          detections,
        }),
      };
    };
    const before = run(false);
    expect(before.live).toBeNull();
    expect(before.result.state).toBe("unknown");
    expect(before.result.open).toEqual([]);
    const ready = run(true);
    expect(ready.result.state).toBe("dr");
    expect(ready.result.open.map((o) => [o.key, o.by])).toEqual([["c", "ar"]]);
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

describe("tracker capture wiring: the series within H", () => {
  // Why this test matters: the kernel reads 'dr' up to H after the newest
  // fix; a wiring that trimmed the series to F (5 s) would read 'unknown'
  // after every short fix gap and drop QR to 1 Hz near a code.
  it("a fix gap within H reads 'dr', one longer than H 'unknown'", () => {
    const state = (gapMs: number) => {
      const { wiring, clock } = rig({
        levels: oneCode(),
        samples: [{ t: T0 - gapMs, north: 0, east: 0, accM: 4 }],
        alignment: IDENTITY,
        arPose: { x: 0, y: 0, z: 0 },
      });
      return judge(wiring, clock.now, {
        levels: oneCode(),
        levelIdByText: new Map(),
        detections: { markers: {} },
      }).state;
    };
    expect(state(30_000)).toBe("dr");
    expect(state(DEFAULT_NEARBY_PARAMS.H - 1_000)).toBe("dr");
    expect(state(DEFAULT_NEARBY_PARAMS.H + 1_000)).toBe("unknown");
  });

  // Why this test matters: R_AR grows with the AR path walked since the
  // sighting, and that path is the device samples within H. A wiring that
  // trimmed to F would drop the walk 50 s ago and shrink R_AR, closing a
  // code the visitor walked away from and back to.
  it("R_AR counts the path walked within H", () => {
    const detections: QrDetectionsView = {
      frameEpoch: 0,
      markers: {
        "text-c": {
          detections: [
            { timestamp: T0 - 55_000, cameraPose: { position: [0, 0, 0] } },
          ],
        },
      },
    };
    const levels = new Map([["c", level()]]);
    const levelIdByText = new Map([["text-c", "c"]]);
    const { wiring, clock, state } = rig({
      levels,
      levelIdByText,
      // Far fixes (the code has no spot): 50 m out and 50 m back.
      samples: [
        { t: T0 - 54_000, north: 500, east: 500, accM: 4, odom: [50, 0, 0] },
        { t: T0 - 50_000, north: 500, east: 500, accM: 4, odom: [0, 0, 0] },
      ],
      alignment: IDENTITY,
      // odom-NUE [5, 0, 0] is WebXR (0, 0, -5): 5 m from the sighting.
      arPose: { x: 0, y: 0, z: -5 },
    });
    state.detections = detections;
    const result = judge(wiring, clock.now, {
      levels,
      levelIdByText,
      detections,
    });
    // R_AR = 1.5 + 1 + 0.03 x (50 + 50 + 5) = 5.65 m; without the walk,
    // 2.65 m.
    expect(result.open.map((o) => o.key)).toEqual(["c"]);
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

  // Why this test matters: the controller locks a code only after several
  // decodes; a burst that waited for the first detection (the lock) would
  // leave those decodes at 1 Hz, seconds apart. One decode must open full
  // cadence at once.
  it("one decode at 1 Hz opens full cadence, before any lock", () => {
    const { wiring, clock, state } = rig({
      levels: oneCode(),
      samples: fixesAt(500, 500, T0, T0 + 20_000),
    });
    expect(captures(wiring, clock, T0, T0 + 2_000)).toBe(2);
    state.decodeAtMs = T0 + 2_000;
    const burst = captures(wiring, clock, T0 + 2_000, T0 + 2_000 + QR_BURST_MS);
    expect(burst).toBeGreaterThanOrEqual(75);
    // An older lock does not hide the newer decode.
    state.detections = {
      frameEpoch: 0,
      markers: { a: { detections: [{ timestamp: T0 - 60_000 }] } },
    };
    state.decodeAtMs = T0 + 20_000;
    expect(
      captures(wiring, clock, T0 + 20_000, T0 + 21_000),
    ).toBeGreaterThanOrEqual(7);
    // Nor the reverse: an older decode does not hide a newer detection.
    state.decodeAtMs = T0 - 60_000;
    state.detections = {
      frameEpoch: 0,
      markers: { a: { detections: [{ timestamp: T0 + 40_000 }] } },
    };
    expect(
      captures(wiring, clock, T0 + 40_000, T0 + 41_000),
    ).toBeGreaterThanOrEqual(7);
    // The control: with both old, the slow rate.
    expect(captures(wiring, clock, T0 + 60_000, T0 + 61_000)).toBe(1);
  });

  // Why this test matters: a visible poster with a code the session knows
  // is not one it can use (another tour's, one without a print size, an
  // ignored one) would otherwise keep QR at full cadence for as long as it
  // is in view. Its detections open no burst; a usable code's still do.
  it("a detection of a code that opens no burst leaves QR at 1 Hz", () => {
    const { wiring, clock, state } = rig({
      levels: oneCode(),
      samples: fixesAt(500, 500, T0, T0 + 20_000),
      opensBurst: (text) => text !== "foreign",
    });
    state.detections = {
      frameEpoch: 0,
      markers: { foreign: { detections: [{ timestamp: T0 }] } },
    };
    expect(captures(wiring, clock, T0, T0 + 5_000)).toBe(5);
    state.detections = {
      frameEpoch: 0,
      markers: {
        foreign: { detections: [{ timestamp: T0 + 5_000 }] },
        ours: { detections: [{ timestamp: T0 + 5_000 }] },
      },
    };
    expect(
      captures(wiring, clock, T0 + 5_000, T0 + 10_000),
    ).toBeGreaterThanOrEqual(35);
  });

  // Why this test matters: while the scan card asks the visitor to scan a
  // code, the visitor is pointing the camera at one: QR runs at full
  // cadence wherever the position says they are.
  it("the scan gate scanning: every interval with every code closed", () => {
    const { wiring, clock } = rig({
      levels: oneCode(),
      samples: fixesAt(500, 500, T0, T0 + 10_000),
      scanning: true,
    });
    expect(captures(wiring, clock, T0, T0 + 10_000)).toBeGreaterThanOrEqual(75);
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
  // carries none. Values go through raw: the kernel alone decides what a
  // malformed extent or accuracy means, so the two cannot disagree.
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
      ["x", 3, -1],
    ]);
  });

  // Why this test matters: the burst reads the newest hit of any code that
  // opens a burst, and nothing for an empty or malformed history.
  it("the newest hit is the newest detection of any code that opens a burst", () => {
    const markers = {
      a: { detections: [{ timestamp: 5 }, { timestamp: 7 }] },
      b: { detections: [{ timestamp: 9 }] },
    };
    expect(newestHitAtMs({ markers }, (text) => text !== "b")).toBe(7);
    expect(newestHitAtMs({ markers }, () => false)).toBeNull();
    expect(newestHitAtMs({ markers: {} }, () => true)).toBeNull();
    expect(
      newestHitAtMs(
        {
          markers: {
            a: { detections: [{ timestamp: 5 }, { timestamp: 7 }] },
            b: { detections: [{ timestamp: 9 }] },
            c: { detections: [] },
            d: { detections: [{ timestamp: Number.NaN }] },
          },
        },
        () => true,
      ),
    ).toBe(9);
  });

  // Why this test matters: the burst opens on a decode, so the stamp must
  // fire for a frame with a code (and name it, so the caller can skip a
  // code that opens no burst) and stay silent for one without, pass the
  // result through untouched, and still free the detector.
  it("stampDecodes calls back on a decode only and keeps the front end whole", async () => {
    const image = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
    const code = {
      text: "t",
      corners: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    } as const;
    let next: typeof code | null = null;
    const decodes: string[] = [];
    let disposed = 0;
    const stamped = stampDecodes(
      {
        kind: "barcode-detector",
        detect: () => Promise.resolve(next as never),
        dispose: () => {
          disposed += 1;
        },
      },
      (decoded) => {
        decodes.push(decoded.text);
      },
    );
    await expect(stamped.detect(image)).resolves.toBeNull();
    expect(decodes).toEqual([]);
    next = code;
    await expect(stamped.detect(image)).resolves.toBe(code);
    expect(decodes).toEqual(["t"]);
    stamped.dispose?.();
    expect(disposed).toBe(1);
  });

  // Why this test matters: a code's reach is the costly part of its target
  // (geodesic distances over codes and stations), and the detections get a
  // new identity on every decode. The spots are rebuilt only when the
  // levels, the stations or the zero change; a new detection still updates
  // the code's sighting at once, and a frame epoch bump still drops it.
  it("a new detection updates the sighting without rebuilding the spots", () => {
    let geoReads = 0;
    const stationGeo = geoAt(5, 0);
    const station = {
      get geo() {
        geoReads += 1;
        return stationGeo;
      },
      foundRadiusM: 3,
    };
    const levels = new Map([
      ["c", level()],
      ["d", level(geoAt(300, 0))],
    ]);
    const levelIdByText = new Map([["text-c", "c"]]);
    const { wiring, clock, state } = rig({
      levels,
      levelIdByText,
      stations: [station],
      // Far fixes; the odometry and the camera at the AR origin.
      samples: fixesAt(500, 500, T0 - 2_000, T0 + 2_000).map((s) => ({
        ...s,
        odom: [0, 0, 0] as const,
      })),
      alignment: IDENTITY,
      arPose: { x: 0, y: 0, z: 0 },
    });
    // Between the 1 Hz slots: only an open code wants the frame.
    clock.now = T0 + 500;
    expect(wiring.wantsFrame()).toBe(false);
    const built = geoReads;
    expect(built).toBeGreaterThan(0);
    // A sighting older than the burst, where the camera stands.
    const seen = (frameEpoch: number): QrDetectionsView => ({
      frameEpoch,
      markers: {
        "text-c": {
          detections: [
            {
              timestamp: T0 - 20_000,
              frameEpoch: 0,
              cameraPose: { position: [0, 0, 0] },
            },
          ],
        },
      },
    });
    state.detections = seen(0);
    expect(wiring.wantsFrame()).toBe(true);
    expect(wiring.lastRoutes()).toEqual([{ kind: "qr", targetIds: ["c"] }]);
    // A frame epoch bump: the sighting is of an earlier frame.
    state.detections = seen(1);
    expect(wiring.wantsFrame()).toBe(false);
    expect(geoReads).toBe(built);
    // New stations: the spots are rebuilt.
    state.stations = [station];
    wiring.wantsFrame();
    expect(geoReads).toBeGreaterThan(built);
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
