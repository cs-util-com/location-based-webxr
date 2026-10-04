/**
 * The viewer's vote sink (Tour Viewer authoring plan 2026-09-28-0953 §3.2,
 * M2e; decisions D9, D17, D18; the seam contract in
 * `viewer-placement.ts.md`), against the real viewer store.
 *
 * Why these tests matter: they replace `viewer-soft-trim-guard.test.ts`, the
 * tripwire that held while the core refused the soft-trimming keys. With core
 * 1.26 the keys exist, and what must hold now is the DISPATCH ORDER: the
 * keep-alive is unsafe under the hard trim (the M2b/M2d review #3: B = 5 m
 * fails the rule, 8 m jumps, 15 m never hands off), and the soft kernel must
 * never outlive the entry that turned it on (`resetGpsSessionData` keeps
 * overrides, and the corpus never credited the soft kernel for GPS-only
 * solving). And every vote and keep-alive tick must be ONE solve (D18): a
 * lock's ring as one batch, a device fix and its ring as one batch.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { buildQrGpsVotes } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import {
  recordGpsEvent,
  setAlignmentOverrides,
  setZeroPos,
  type RecordGpsEventPayload,
} from "gps-plus-slam-app-framework/state";
import {
  GPS_POINT_SOURCE_DEVICE,
  GPS_POINT_SOURCE_SYNTHETIC_QR,
  gpsPointSourceOf,
} from "gps-plus-slam-app-framework/core";

import { createTourViewerStore } from "./tour-viewer-session.js";
import { startEntryVoteSink, VIEWER_SOFT_TRIM } from "./viewer-vote-sink.js";

const ZERO = { lat: 47.5, lon: 8.7 };
const T0 = 1_790_000_000_000;
const GEO = { lat: 47.50002, lon: 8.70001, alt: 401.5, headingDeg: 90 };
const CODE_POSE = {
  position: [0.5, 1.5, -2] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
};

const ring = (atMs: number, count = 16): RecordGpsEventPayload[] =>
  buildQrGpsVotes({
    qrPoseWorld: CODE_POSE,
    sizeM: 0.2,
    qrGeo: GEO,
    syntheticAccuracyM: 5,
    baselineM: 30,
    count,
    timestamp: atMs,
  });

const deviceFix = (
  i: number,
  over: Partial<RecordGpsEventPayload["rawGpsPoint"]> = {},
): RecordGpsEventPayload => ({
  odomPosition: [i * 0.7, 1.4, -i * 0.3],
  odomRotation: [0, 0, 0, 1],
  rawGpsPoint: {
    id: `gps-${String(i)}`,
    latitude: ZERO.lat + i * 0.000004,
    longitude: ZERO.lon + i * 0.000003,
    altitude: 401,
    latLongAccuracy: 3,
    timestamp: T0 + i * 1000,
    ...over,
  },
});

/** The viewer store, its session zero and one fix, with every action a
 *  caller dispatches logged (middleware-internal dispatches are not). */
function storeWithLog() {
  const store = createTourViewerStore();
  store.dispatch(setZeroPos(ZERO));
  store.dispatch(recordGpsEvent(deviceFix(0)));
  const log: { type: string; payload?: unknown }[] = [];
  const dispatch = store.dispatch.bind(store);
  const logged = {
    ...store,
    dispatch: ((action: { type: string; payload?: unknown }) => {
      log.push(action);
      return dispatch(action as never);
    }) as typeof store.dispatch,
  };
  return { store: logged, log };
}

const overrides = (s: { getState: () => unknown }) =>
  (
    s.getState() as {
      gpsData: { alignmentOverrides?: Record<string, unknown> | null };
    }
  ).gpsData.alignmentOverrides ?? null;
const positions = (s: { getState: () => unknown }) =>
  (
    s.getState() as {
      gpsData: { gpsEvents?: { gpsPositions: { source?: string }[] } };
    }
  ).gpsData.gpsEvents?.gpsPositions ?? [];

describe("an AR entry's vote sink: the per-entry solver overrides (M2e; the seam contract)", () => {
  it("clears any previous entry's overrides FIRST, at the entry's start, before any vote", () => {
    const { store, log } = storeWithLog();
    store.dispatch(setAlignmentOverrides({ ...VIEWER_SOFT_TRIM }));
    log.length = 0;

    startEntryVoteSink(store);

    expect(log).toEqual([setAlignmentOverrides(null)]);
    expect(overrides(store)).toBeNull();
  });

  it("turns the soft trimming on right before the entry's first vote, merged over the current overrides, and once only", () => {
    const { store, log } = storeWithLog();
    const sink = startEntryVoteSink(store);
    // Something set in this entry before its first vote survives the merge
    // (the action REPLACES the whole object).
    store.dispatch(setAlignmentOverrides({ timeWeightFactor: 100 }));
    log.length = 0;

    sink.castLockVotes(ring(T0 + 500));
    sink.castLockVotes(ring(T0 + 625));

    expect(log.map((a) => a.type)).toEqual([
      setAlignmentOverrides.type,
      "gpsData/recordGpsEventBatch",
      "gpsData/recordGpsEventBatch",
    ]);
    expect(overrides(store)).toEqual({
      timeWeightFactor: 100,
      outlierFalloffEnabled: true,
      outlierFalloffRadiusMeters: 1,
      outlierFalloffExponent: 1,
      outlierRejectionEnabled: false,
    });
  });

  it("a keep-alive tick that brings the first vote turns it on too - no vote ever meets the hard trim", () => {
    const { store, log } = storeWithLog();
    const sink = startEntryVoteSink(store);
    log.length = 0;
    sink.recordFix(deviceFix(1), ring(T0 + 1000));
    expect(log.map((a) => a.type)).toEqual([
      setAlignmentOverrides.type,
      "gpsData/recordGpsEventBatch",
    ]);
  });

  it("a fix with no ring changes no override: an entry that never votes keeps the plain solver", () => {
    const { store, log } = storeWithLog();
    const sink = startEntryVoteSink(store);
    log.length = 0;
    sink.recordFix(deviceFix(1), []);
    expect(log.map((a) => a.type)).toEqual(["gpsData/recordGpsEvent"]);
    expect(overrides(store)).toBeNull();
  });

  it("once on, it stays on for the rest of the entry, and only the next entry's start clears it", () => {
    // Why (M2e milestone review #1): every vote the entry cast stays in the
    // GPS history until AR exit, so turning the soft kernel off inside the
    // entry (it used to happen at a tour switch) puts the hard trim back
    // onto them - the 2.8-5.8 m jump M0b/M2b measured at a 5-8 m bias.
    const { store, log } = storeWithLog();
    const sink = startEntryVoteSink(store);
    sink.castLockVotes(ring(T0 + 500));
    log.length = 0;

    sink.recordFix(deviceFix(1), []);
    sink.recordFix(deviceFix(2), ring(T0 + 2000));
    sink.castLockVotes(ring(T0 + 9000));
    expect(log.map((a) => a.type)).not.toContain(setAlignmentOverrides.type);
    expect(overrides(store)).toEqual(VIEWER_SOFT_TRIM);

    startEntryVoteSink(store);
    expect(overrides(store)).toBeNull();
  });

  it("the soft keys are the ones M0c measured: kernel on, r0 = 1 m, p = 1, hard trim off", () => {
    expect(VIEWER_SOFT_TRIM).toEqual({
      outlierFalloffEnabled: true,
      outlierFalloffRadiusMeters: 1,
      outlierFalloffExponent: 1,
      outlierRejectionEnabled: false,
    });
    // The published core takes them (it refused them before 1.26).
    expect(() => setAlignmentOverrides({ ...VIEWER_SOFT_TRIM })).not.toThrow();
  });
});

describe("an AR entry's vote sink: one solve per lock and per keep-alive tick (D18)", () => {
  it("a lock's whole ring is ONE batch: every vote stored, stamped synthetic", () => {
    const { store, log } = storeWithLog();
    const sink = startEntryVoteSink(store);
    const before = positions(store).length;
    log.length = 0;
    sink.castLockVotes(ring(T0 + 500));
    expect(log.filter((a) => a.type.startsWith("gpsData/record"))).toEqual([
      expect.objectContaining({
        type: "gpsData/recordGpsEventBatch",
        payload: { events: ring(T0 + 500) },
      }),
    ]);
    const added = positions(store).slice(before);
    expect(added).toHaveLength(16);
    for (const p of added) {
      expect(gpsPointSourceOf(p)).toBe(GPS_POINT_SOURCE_SYNTHETIC_QR);
    }
  });

  it("a keep-alive tick is ONE store action holding the device fix FIRST, then its ring", () => {
    const { store, log } = storeWithLog();
    const sink = startEntryVoteSink(store);
    sink.castLockVotes(ring(T0 + 500)); // the soft keys are on from here
    const before = positions(store).length;
    log.length = 0;

    sink.recordFix(deviceFix(1), ring(T0 + 1000));

    expect(log).toHaveLength(1);
    expect(log[0]!.type).toBe("gpsData/recordGpsEventBatch");
    expect(
      (log[0]!.payload as { events: RecordGpsEventPayload[] }).events,
    ).toEqual([deviceFix(1), ...ring(T0 + 1000)]);
    const added = positions(store).slice(before);
    expect(added).toHaveLength(17);
    expect(gpsPointSourceOf(added[0]!)).toBe(GPS_POINT_SOURCE_DEVICE);
  });

  it("a malformed device fix inside a tick is dropped alone by the core - the ring is stored and nothing throws", () => {
    // Why: one corrupt fix (a non-finite coordinate from a misbehaving
    // receiver) must not take its ring down with it, nor throw out of the
    // GPS callback (core 1.26: each event is judged as a single dispatch
    // would judge it).
    const { store } = storeWithLog();
    const sink = startEntryVoteSink(store);
    sink.castLockVotes(ring(T0 + 500));
    const before = positions(store).length;
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      expect(() => {
        sink.recordFix(deviceFix(1, { latitude: Number.NaN }), ring(T0 + 1000));
      }).not.toThrow();
    } finally {
      console.warn = warn;
    }
    const added = positions(store).slice(before);
    expect(added).toHaveLength(16);
    for (const p of added) {
      expect(gpsPointSourceOf(p)).toBe(GPS_POINT_SOURCE_SYNTHETIC_QR);
    }
  });
});

/**
 * Per-test timeout of the retraction tests. The first stores 300 device
 * fixes, each a full solve over the growing history, then re-feeds them: it
 * took 4.6 s run alone (2026-10-02, two workers) - next to the 5 s default -
 * and over 5 s in three of this day's gate runs while other sessions' suites loaded the
 * machine. It failed on time alone, never on an assertion.
 */
const RETRACT_MS = 60_000;

describe(
  "an AR entry's vote sink: retracting the votes of a moved code (D20, M5c)",
  { timeout: RETRACT_MS },
  () => {
    // Why (M5a recovery arms, results doc "Recovery after a veto"): once the
    // viewer decides a code was moved, its votes already in the history hold
    // the alignment on the wrong spot - aged out they were still 5-8 m off
    // after 10 minutes. Only a reset and a re-feed of the device fixes, with
    // the soft keys off, lands exactly on the GPS answer. The batches stay
    // within the core's 256-event limit.
    it("resets the history, re-feeds only the device fixes in batches of at most 256, with the soft keys off", () => {
      const { store, log } = storeWithLog();
      const sink = startEntryVoteSink(store);
      sink.castLockVotes(ring(T0 + 500));
      for (let i = 1; i <= 300; i += 1) {
        sink.recordFix(deviceFix(i), i % 50 === 0 ? ring(T0 + i * 1000) : []);
      }
      expect(overrides(store)).toMatchObject(VIEWER_SOFT_TRIM);
      log.length = 0;
      const result = sink.retractVotes();
      expect(result).toEqual({ refedFixes: 300, batches: 2 });
      expect(log.map((a) => a.type)).toEqual([
        "gpsData/setAlignmentOverrides",
        "gpsData/resetGpsSessionData",
        "gpsData/recordGpsEventBatch",
        "gpsData/recordGpsEventBatch",
      ]);
      const sizes = log
        .filter((a) => a.type === "gpsData/recordGpsEventBatch")
        .map((a) => (a.payload as { events: unknown[] }).events.length);
      expect(sizes).toEqual([256, 44]);
      expect(overrides(store)).toBeNull();
      const stored = positions(store);
      expect(stored).toHaveLength(300);
      for (const p of stored) {
        expect(gpsPointSourceOf(p)).toBe(GPS_POINT_SOURCE_DEVICE);
      }
    });

    // Why (M5c review L5): the re-feed's batch size (module-private
    // `RETRACT_BATCH_SIZE`, 256 - the sizes the test above pins) is the
    // core's per-batch limit, which the framework does not re-export. A core
    // that lowered it would refuse every full batch of a re-feed; this reads
    // the limit from the core the framework actually resolves, so the two
    // cannot drift apart silently.
    it("re-feeds in batches of the installed core's MAX_GPS_EVENT_BATCH_SIZE (256)", async () => {
      const frameworkPkg = path.resolve(
        import.meta.dirname,
        "../node_modules/gps-plus-slam-app-framework/package.json",
      );
      const corePath = createRequire(frameworkPkg).resolve("gps-plus-slam-js");
      const core = (await import(pathToFileURL(corePath).href)) as Record<
        string,
        unknown
      >;
      expect(core["MAX_GPS_EVENT_BATCH_SIZE"]).toBe(256);
    });

    // Why: after the retraction the history holds no vote, so the hard trim
    // is safe again; a later code's first vote must turn the soft keys back
    // on (the jump regime M0b measured otherwise).
    it("turns the soft keys on again before the next vote, and keeps collecting fixes", () => {
      const { store } = storeWithLog();
      const sink = startEntryVoteSink(store);
      sink.castLockVotes(ring(T0 + 500));
      sink.recordFix(deviceFix(1), []);
      sink.retractVotes();
      sink.recordFix(deviceFix(2), []);
      expect(overrides(store)).toBeNull();
      sink.castLockVotes(ring(T0 + 3000));
      expect(overrides(store)).toMatchObject(VIEWER_SOFT_TRIM);
      expect(sink.retractVotes()).toEqual({ refedFixes: 2, batches: 1 });
    });
  },
);
