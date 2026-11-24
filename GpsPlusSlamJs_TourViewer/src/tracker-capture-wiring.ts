/**
 * The visitor's tracker capture gate for one AR session: creates the
 * framework's generic gate (`ar/targets/tracker-capture-gate`) and
 * registers QR, the first tracker, with the tour's codes as targets. The
 * camera asks `wantsFrame` before each capture: in full cadence while a
 * code is near (the nearby-targets kernel), right after a code that may be
 * the tour's was decoded and while the scan card asks for a code, at 1 Hz
 * otherwise, so codes without a position and codes of other tours are
 * still read outside every gate.
 *
 * Every AR position handed to the kernel is odom-NUE: the store keeps its
 * odometry so, and the live pose and a code's sighting (raw WebXR) go
 * through the same conversion (`odomNueOfWebXr`).
 *
 * Visitor mode only: a creator's session registers nothing, so a gate
 * there would veto every frame.
 *
 * @see tracker-capture-wiring.ts.md
 */

import type { LatLong } from "gps-plus-slam-app-framework/core";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  QrDetection,
  QrFrontEnd,
} from "gps-plus-slam-app-framework/ar/qr/qr-frontend";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import {
  createNearbyPositionSource,
  odomNueOfWebXr,
  type NearbyGpsEvents,
  type NearbyPosition,
} from "gps-plus-slam-app-framework/ar/targets/nearby-position";
import {
  DEFAULT_NEARBY_PARAMS,
  type ArPose,
  type LivePose,
  type NearbyParams,
  type Target,
} from "gps-plus-slam-app-framework/ar/targets/nearby-targets";
import {
  createTrackerCaptureGate,
  type FrameRoute,
} from "gps-plus-slam-app-framework/ar/targets/tracker-capture-gate";
import {
  CODE_HELD_ERROR_M,
  positionPrecision,
  type PrecisionGpsPoint,
} from "gps-plus-slam-app-framework/state/position-precision";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";

import { horizontalM, takesAlong } from "./move-with-code.js";
import { HUD_ARRIVAL_BAND_M } from "./station-bands.js";
import { cameraNue, type ArPoseLike } from "./visitor-position.js";

/** After any code is decoded, full cadence for this long (ms). */
export const QR_BURST_MS = 10_000;
/** QR's rate while no code is near, and while the position is unknown:
 *  codes without a position and other tours' codes are read at it. */
const QR_SLOW_HZ = 1;

/** A station as a code's reach reads it. */
export interface CodeStation {
  readonly geo: QrGeoPose;
  readonly foundRadiusM: number;
}

/** The detections the wiring reads (`qrDetected`). */
export interface QrDetectionsView {
  readonly markers: Readonly<
    Record<
      string,
      {
        readonly detections: readonly {
          readonly timestamp: number;
          readonly frameEpoch?: number;
          readonly cameraPose?: { readonly position: readonly number[] };
        }[];
      }
    >
  >;
  readonly frameEpoch?: number;
}

/**
 * How far from its saved spot a code may be read and still matter (m):
 * the farthest found radius of the stations it takes along (the stations
 * nearer it than any other code, within its reach: `takesAlong`), plus
 * that station's distance from the code, plus the HUD's arrival band. A
 * visitor inside a station's found band is then inside the code's gate.
 * A code with no station: the band alone.
 */
export function codeReachM(
  code: QrGeoPose,
  stations: readonly CodeStation[],
  otherCodes: readonly QrGeoPose[],
): number {
  let reach = 0;
  for (const station of stations) {
    if (!takesAlong(station.geo, code, otherCodes)) continue;
    const found = Number.isFinite(station.foundRadiusM)
      ? Math.max(0, station.foundRadiusM)
      : 0;
    reach = Math.max(reach, found + horizontalM(code, station.geo));
  }
  return reach + HUD_ARRIVAL_BAND_M;
}

/**
 * The front end with every decode stamped: `onDecode` runs with the decoded
 * code when a detect resolves with one, before the controller validates or
 * locks it. The burst opens on it, so the decodes a lock needs run at full
 * cadence; the caller skips the codes that open no burst.
 */
export function stampDecodes(
  frontEnd: QrFrontEnd,
  onDecode: (decoded: QrDetection) => void,
): QrFrontEnd {
  return {
    kind: frontEnd.kind,
    detect: async (image) => {
      const result = await frontEnd.detect(image);
      if (result !== null) onDecode(result);
      return result;
    },
    ...(frontEnd.dispose === undefined
      ? {}
      : { dispose: () => frontEnd.dispose?.() }),
  };
}

/** The newest detection's time (epoch ms) of any code whose text
 *  `opensBurst`, or null. */
export function newestHitAtMs(
  detections: QrDetectionsView,
  opensBurst: (text: string) => boolean,
): number | null {
  let newest: number | null = null;
  for (const [text, marker] of Object.entries(detections.markers)) {
    if (!opensBurst(text)) continue;
    const last = marker.detections[marker.detections.length - 1];
    const t = last?.timestamp;
    if (typeof t === "number" && Number.isFinite(t) && (newest ?? t) <= t) {
      newest = t;
    }
  }
  return newest;
}

/**
 * The tour's codes as the kernel's targets, keyed by level id: each at its
 * saved spot (NaN without a zero or a spot: then only its sighting opens
 * it), with its mint accuracy (and a heading-uncertain mint's GPS extent), its
 * reach, and its newest sighting of the current AR frame (odom-NUE).
 */
export function codeTargets(input: {
  readonly levels: ReadonlyMap<string, QrLevel> | null;
  readonly levelIdByText: ReadonlyMap<string, string>;
  readonly stations: readonly CodeStation[];
  readonly zero: LatLong | null;
  readonly detections: QrDetectionsView;
}): Target[] {
  return withSightings(
    codeSpots(input.levels, input.stations, input.zero),
    sightingsById(input.detections, input.levelIdByText),
  );
}

/** The codes' targets without sightings: spot, accuracy and reach, the
 *  costly part (geodesic distances over codes and stations). */
function codeSpots(
  levels: ReadonlyMap<string, QrLevel> | null,
  stations: readonly CodeStation[],
  zero: LatLong | null,
): Target[] {
  if (levels === null) return [];
  const spots = [...levels.values()]
    .map((level) => level.qr.geo)
    .filter((geo): geo is QrGeoPose => geo !== undefined);
  const targets: Target[] = [];
  for (const [id, level] of levels) {
    const geo = level.qr.geo;
    const nue =
      geo === undefined || zero === null
        ? null
        : calcRelativeCoordsInMeters(zero, {
            lat: geo.lat,
            lon: geo.lon,
          });
    targets.push({
      key: id,
      kind: "qr",
      north: nue?.[0] ?? Number.NaN,
      east: nue?.[2] ?? Number.NaN,
      // Raw: the kernel decides what a malformed value means.
      accM: level.qr.mintQuality?.gpsAccuracyM ?? null,
      ...headingExtent(level),
      reachM:
        geo === undefined
          ? HUD_ARRIVAL_BAND_M
          : codeReachM(
              geo,
              stations,
              spots.filter((other) => other !== geo),
            ),
    });
  }
  return targets;
}

/** The targets with each code's sighting added; a code without one is
 *  passed as it is. */
function withSightings(
  spots: readonly Target[],
  sightings: ReadonlyMap<string, ArPose>,
): Target[] {
  return spots.map((target) => {
    const sighting = sightings.get(target.key);
    return sighting === undefined ? target : { ...target, sighting };
  });
}

/** `fn` memoised on its last arguments (by identity). */
function lastCall<A extends readonly unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  let last: { args: A; result: R } | null = null;
  return (...args) => {
    if (last === null || args.some((a, i) => a !== last!.args[i])) {
      last = { args, result: fn(...args) };
    }
    return last.result;
  };
}

/** A heading-uncertain mint's alignment GPS extent, which the kernel
 *  widens the code's accuracy by; nothing for a certain mint. */
function headingExtent(level: QrLevel): { alignmentGpsExtentM?: number } {
  const q = level.qr.mintQuality;
  const extent = q?.alignmentGpsExtentM;
  return q?.headingUncertain === true && extent !== undefined
    ? { alignmentGpsExtentM: extent }
    : {};
}

/** Each level's newest sighting in the current frame epoch (odom-NUE). */
function sightingsById(
  detections: QrDetectionsView,
  levelIdByText: ReadonlyMap<string, string>,
): Map<string, ArPose> {
  const epoch = detections.frameEpoch ?? 0;
  const out = new Map<string, ArPose>();
  for (const [text, marker] of Object.entries(detections.markers)) {
    const id = levelIdByText.get(text);
    if (id === undefined) continue;
    for (let i = marker.detections.length - 1; i >= 0; i -= 1) {
      const d = marker.detections[i]!;
      if ((d.frameEpoch ?? 0) !== epoch) continue;
      const p = d.cameraPose?.position;
      const pos =
        p === undefined
          ? null
          : odomNueOfWebXr({ x: p[0]!, y: p[1]!, z: p[2]! });
      if (pos === null || !Number.isFinite(d.timestamp)) continue;
      const known = out.get(id);
      if (known === undefined || known.t < d.timestamp) {
        out.set(id, { t: d.timestamp, pos });
      }
      break;
    }
  }
  return out;
}

export interface TrackerCaptureWiringDeps {
  /** Epoch ms: the QR controller's clock, so a detection's time and the
   *  gate's compare directly. */
  now(): number;
  /** The camera source's capture interval (ms): the in-gate rate. */
  readonly captureIntervalMs: number;
  /** The store's GPS event series (`gpsData.gpsEvents`), or null. */
  gpsEvents(): NearbyGpsEvents | null;
  /** The store's alignment, or null. Stable per value (a selector). */
  alignment(): ArrayLike<number> | null;
  /** The page's alignment readiness (`stationAlignmentSignals`): the
   *  store's alignment is the identity from the first fix, so until this
   *  is true the gate judges by the lone fix, as the station guide does. */
  alignmentReady(): boolean;
  /** The session's GPS zero, or null. Stable per value (a selector). */
  zero(): LatLong | null;
  /** The store's GPS readings (the precision rule's input). */
  gpsPoints(): readonly PrecisionGpsPoint[];
  /** The raw WebXR camera pose, or null. */
  arPose(): ArPoseLike | null;
  /** A code lined the alignment up (`stationAlignmentSignals`). */
  codeLinedUp(): boolean;
  levels(): ReadonlyMap<string, QrLevel> | null;
  levelIdByText(): ReadonlyMap<string, string>;
  stations(): readonly CodeStation[];
  detections(): QrDetectionsView;
  /** The newest decode that opens the burst (epoch ms, `stampDecodes`),
   *  or null. */
  lastDecodeAtMs(): number | null;
  /** Whether a code's text opens the burst: false for a code the session
   *  knows it cannot use (no level in this tour, no print size, ignored). */
  opensBurst(text: string): boolean;
  /** The QR controller cannot take a frame now. */
  qrBusy(): boolean;
  /** The visitor's setting: QR at full cadence everywhere. */
  forcePref(): boolean;
  /** The session runs on codes alone: no fix ever comes. */
  codesOnly(): boolean;
  /** The scan card asks the visitor to scan a code. */
  scanning(): boolean;
  readonly params?: NearbyParams;
}

export interface TrackerCaptureWiring {
  /** The camera's question before a capture. */
  wantsFrame(): boolean;
  /** The routes of the newest frame `wantsFrame` took: the captured
   *  frame goes to these trackers. Null before the gate wanted one (a
   *  frame source that does not ask). */
  lastRoutes(): readonly FrameRoute[] | null;
  /** What the gate reads at `nowMs`: the series within H and the live
   *  pose, every AR position odom-NUE. */
  position(nowMs: number): NearbyPosition;
}

/** Creates the gate for one AR session and registers QR. */
export function createTrackerCaptureWiring(
  deps: TrackerCaptureWiringDeps,
): TrackerCaptureWiring {
  const params = deps.params ?? DEFAULT_NEARBY_PARAMS;
  const source = createNearbyPositionSource({
    gpsEvents: () => deps.gpsEvents(),
    alignment: () => readyAlignment(deps),
    zero: () => deps.zero(),
    live: () => livePose(deps),
    lookBackMs: params.H,
  });
  const gate = createTrackerCaptureGate({
    position: (nowMs) => source.position(nowMs),
    params,
    captureIntervalMs: deps.captureIntervalMs,
  });
  const fullHz = 1000 / deps.captureIntervalMs;
  // Two memos: the spots on what they read (levels, stations, zero), the
  // sightings on the detections (new per decode; their epoch is in them)
  // and the text map, which grows in place as codes resolve, so its size
  // is part of the key.
  const spots = lastCall(codeSpots);
  const sightings = lastCall(
    (
      detections: QrDetectionsView,
      levelIdByText: ReadonlyMap<string, string>,
      _size: number,
    ) => sightingsById(detections, levelIdByText),
  );
  const combined = lastCall(withSightings);
  const targets = (): Target[] => {
    const levelIdByText = deps.levelIdByText();
    return combined(
      spots(deps.levels(), deps.stations(), deps.zero()),
      sightings(deps.detections(), levelIdByText, levelIdByText.size),
    );
  };
  gate.register({
    kind: "qr",
    targets,
    cadence: {
      inGateHz: fullHz,
      outsideHz: QR_SLOW_HZ,
      unknownHz: QR_SLOW_HZ,
      burstHz: fullHz,
      burstMs: QR_BURST_MS,
    },
    isBusy: () => deps.qrBusy(),
    lastHitAtMs: () =>
      laterOf(
        deps.lastDecodeAtMs(),
        newestHitAtMs(deps.detections(), (text) => deps.opensBurst(text)),
      ),
    forceOn: () => deps.forcePref() || deps.codesOnly() || deps.scanning(),
  });
  let routes: readonly FrameRoute[] | null = null;
  return {
    wantsFrame() {
      const now = gate.kindsFor(deps.now());
      if (now.length > 0) routes = now;
      return now.length > 0;
    },
    lastRoutes: () => routes,
    position: (nowMs) => source.position(nowMs),
  };
}

/** The store's alignment once the page calls it ready, else null. */
function readyAlignment(
  deps: TrackerCaptureWiringDeps,
): ArrayLike<number> | null {
  return deps.alignmentReady() ? deps.alignment() : null;
}

/** The later of two times; either alone; null when neither is finite. */
function laterOf(a: number | null, b: number | null): number | null {
  const times = [a, b].filter(
    (t): t is number => t !== null && Number.isFinite(t),
  );
  return times.length === 0 ? null : Math.max(...times);
}

/** The live pose: the aligned camera and its odom-NUE AR position of the
 *  same tick, with the precision rule's acc_fix (a code hold: 1 m). Null
 *  without a ready alignment or a pose, so before the alignment is ready
 *  the AR gate and 'dr' are off: only a fresh lone fix opens a code. */
function livePose(deps: TrackerCaptureWiringDeps): LivePose | null {
  const pose = deps.arPose();
  const nue = cameraNue(readyAlignment(deps), pose);
  const ar = odomNueOfWebXr(pose?.position);
  if (nue === null || ar === null) return null;
  const precision = positionPrecision({
    position: "aligned",
    codeHold: deps.codeLinedUp(),
    gpsPoints: deps.gpsPoints(),
  });
  return {
    t: deps.now(),
    north: nue[0],
    east: nue[2],
    ar,
    accM:
      precision.source === "code"
        ? CODE_HELD_ERROR_M
        : precision.source === "gps"
          ? precision.accuracyM
          : null,
  };
}
