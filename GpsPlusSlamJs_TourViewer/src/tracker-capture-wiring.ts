/**
 * The visitor's tracker capture gate for one AR session: creates the
 * framework's generic gate (`ar/targets/tracker-capture-gate`) and
 * registers QR, the first tracker, with the tour's codes as targets. The
 * camera asks `wantsFrame` before each capture: in full cadence while a
 * code is near (the nearby-targets kernel) or right after any code was
 * read, at 1 Hz otherwise, so codes without a position and codes of other
 * tours are still read outside every gate.
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

/** After any code is read, full cadence for this long (ms). */
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

/** The newest detection's time of any code (epoch ms), or null. */
export function newestHitAtMs(detections: QrDetectionsView): number | null {
  let newest: number | null = null;
  for (const marker of Object.values(detections.markers)) {
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
 * it), with its mint accuracy widened for a heading-uncertain mint, its
 * reach, and its newest sighting of the current AR frame (odom-NUE).
 */
export function codeTargets(input: {
  readonly levels: ReadonlyMap<string, QrLevel> | null;
  readonly levelIdByText: ReadonlyMap<string, string>;
  readonly stations: readonly CodeStation[];
  readonly zero: LatLong | null;
  readonly detections: QrDetectionsView;
  readonly params: NearbyParams;
}): Target[] {
  if (input.levels === null) return [];
  const sightings = sightingsById(input.detections, input.levelIdByText);
  const spots = [...input.levels.values()]
    .map((level) => level.qr.geo)
    .filter((geo): geo is QrGeoPose => geo !== undefined);
  const targets: Target[] = [];
  for (const [id, level] of input.levels) {
    const geo = level.qr.geo;
    const nue =
      geo === undefined || input.zero === null
        ? null
        : calcRelativeCoordsInMeters(input.zero, {
            lat: geo.lat,
            lon: geo.lon,
          });
    const sighting = sightings.get(id);
    targets.push({
      key: id,
      kind: "qr",
      north: nue?.[0] ?? Number.NaN,
      east: nue?.[2] ?? Number.NaN,
      accM: codeAccuracyM(level, input.params),
      reachM:
        geo === undefined
          ? HUD_ARRIVAL_BAND_M
          : codeReachM(
              geo,
              input.stations,
              spots.filter((other) => other !== geo),
            ),
      ...(sighting === undefined ? {} : { sighting }),
    });
  }
  return targets;
}

/** The mint's accuracy, plus the factor times its alignment's GPS extent
 *  for a heading-uncertain mint; null (the kernel's default) without one. */
function codeAccuracyM(level: QrLevel, params: NearbyParams): number | null {
  const q = level.qr.mintQuality;
  const own = positive(q?.gpsAccuracyM);
  const extent = q?.alignmentGpsExtentM;
  if (q?.headingUncertain !== true || !isNonNegative(extent)) return own;
  return (
    (own ?? params.defaultTargetAccM) +
    params.headingUncertainExtentFactor * extent
  );
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
  /** The QR controller cannot take a frame now. */
  qrBusy(): boolean;
  /** The visitor's setting: QR at full cadence everywhere. */
  forcePref(): boolean;
  /** The session runs on codes alone: no fix ever comes. */
  codesOnly(): boolean;
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
    gpsEvents: deps.gpsEvents,
    alignment: deps.alignment,
    zero: deps.zero,
    live: () => livePose(deps),
    lookBackMs: params.H,
  });
  const gate = createTrackerCaptureGate({
    position: (nowMs) => source.position(nowMs),
    params,
    captureIntervalMs: deps.captureIntervalMs,
  });
  const fullHz = 1000 / deps.captureIntervalMs;
  let memo: { key: readonly unknown[]; targets: Target[] } | null = null;
  const targets = (): Target[] => {
    const input = {
      levels: deps.levels(),
      levelIdByText: deps.levelIdByText(),
      stations: deps.stations(),
      zero: deps.zero(),
      detections: deps.detections(),
      params,
    };
    // The text map grows in place as codes resolve: its size is the key.
    const key = [
      input.levels,
      input.levelIdByText,
      input.levelIdByText.size,
      input.stations,
      input.zero,
      input.detections,
    ];
    if (memo === null || key.some((k, i) => k !== memo!.key[i])) {
      memo = { key, targets: codeTargets(input) };
    }
    return memo.targets;
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
    isBusy: deps.qrBusy,
    lastHitAtMs: () => newestHitAtMs(deps.detections()),
    forceOn: () => deps.forcePref() || deps.codesOnly(),
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

/** The live pose: the aligned camera and its odom-NUE AR position of the
 *  same tick, with the precision rule's acc_fix (a code hold: 1 m). Null
 *  without an alignment or a pose. */
function livePose(deps: TrackerCaptureWiringDeps): LivePose | null {
  const pose = deps.arPose();
  const nue = cameraNue(deps.alignment(), pose);
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

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function isNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
