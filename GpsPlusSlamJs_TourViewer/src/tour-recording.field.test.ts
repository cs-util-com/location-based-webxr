/**
 * A field recording, read through the app's own parsers (opt-in).
 *
 * Why this test exists: the owner's troubleshooting recordings
 * (`authoring-recording.ts`, "Record this session for troubleshooting") are
 * the only evidence of what the Tour Viewer did on a real phone. They hold
 * the owner's GPS track, so they live in the PRIVATE repo
 * (`gps-plus-slam/TestDataJs-Other/tour-viewer/`) and this test reads one by
 * path: `TOUR_RECORDING=<zip> pnpm run test:unit
 * src/tour-recording.field.test.ts`. Without the variable it is skipped, so
 * the public gate never needs the private file. Nothing is unzipped by
 * hand: the framework's zip reader and the store do the reading.
 *
 * It prints a report and pins what the recording proves; findings live in
 * the dated analysis doc of each recording.
 */
import { existsSync, readFileSync } from "node:fs";
import { TextWriter } from "@zip.js/zip.js";
import { tourManifestEntryOf } from "gps-plus-slam-app-framework/ar/tour-archive";
import {
  parseTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  loadActionsFromZip,
  loadEntriesFromSubdir,
  readZipEntries,
  type RecordedAction,
} from "gps-plus-slam-app-framework/storage";
import { packDepthAction } from "gps-plus-slam-app-framework/storage/depth-sample-codec";
import { loadSessionMetadata } from "gps-plus-slam-app-framework/storage/zip-reader";
import {
  selectGpsPositions,
  selectOdometryPositions,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import { createTourViewerStore } from "./tour-viewer-session.js";
import { withWorldObjects } from "./test-support/tour-of.js";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  alignmentTurnDeg,
  codePositionSentence,
} from "./code-position-rule.js";
import { planCodePosition } from "./code-position-settle.js";
import {
  planVisitSettle,
  storedGeo,
  storedSizeM,
  type CodeSighting,
  visitEndChoice,
} from "./visit-settle.js";
import { CODE_MOVE_RULE } from "./code-displacement.js";
import { createMovedCodeChecks } from "./moved-code-check.js";
import { CODE_TURN_RULE } from "./moved-code-rule.js";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import { createWalkedDistanceTracker } from "./walked-distance-tracker.js";

const ZIP = process.env.TOUR_RECORDING;

interface Fix {
  readonly latitude: number;
  readonly longitude: number;
  readonly latLongAccuracy?: number;
  readonly timestamp?: number;
}

function fixesOf(action: RecordedAction): Fix[] {
  const p = action.payload as
    { rawGpsPoint?: Fix; events?: { rawGpsPoint?: Fix }[] } | undefined;
  if (action.type === "gpsData/recordGpsEvent" && p?.rawGpsPoint) {
    return [p.rawGpsPoint];
  }
  if (
    action.type === "gpsData/recordGpsEventBatch" &&
    Array.isArray(p?.events)
  ) {
    return p.events.flatMap((e) => (e.rawGpsPoint ? [e.rawGpsPoint] : []));
  }
  return [];
}

function metresBetween(a: Fix, b: Fix): number {
  const n = (b.latitude - a.latitude) * 111_320;
  const e =
    (b.longitude - a.longitude) *
    111_320 *
    Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(n, e);
}

const quantile = (values: number[], q: number): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
};

describe.skipIf(ZIP === undefined)("a Tour Viewer field recording", () => {
  it("reads, and reports what happened", async () => {
    if (ZIP === undefined || !existsSync(ZIP)) {
      throw new Error(`TOUR_RECORDING does not name a file: ${String(ZIP)}`);
    }
    const bytes = new Uint8Array(readFileSync(ZIP));
    const meta = await loadSessionMetadata(bytes);
    const loaded = await loadActionsFromZip(bytes);
    const actions = loaded.map((e) => e.action);
    // Where the bytes go, per action type: the baseline the scan pass's
    // binary depth (S2) is measured against.
    const sizeOf = new Map(
      (await readZipEntries(bytes)).map((e) => [
        e.filename,
        { stored: e.compressedSize, raw: e.uncompressedSize },
      ]),
    );
    const bytesByType = new Map<string, { stored: number; raw: number }>();
    for (const e of loaded) {
      const size = sizeOf.get(e.filename);
      if (size === undefined) continue;
      const sum = bytesByType.get(e.action.type) ?? { stored: 0, raw: 0 };
      bytesByType.set(e.action.type, {
        stored: sum.stored + size.stored,
        raw: sum.raw + size.raw,
      });
    }
    // The same actions as the recording writes them since scan pass S2
    // (compact JSON, depth packed): what a recording of this visit costs
    // now (S2 plan, follow-up 2 - the budget's rate of the other actions).
    const writtenByType = new Map<string, number>();
    for (const e of loaded) {
      const written = new TextEncoder().encode(
        JSON.stringify(packDepthAction(e.action)),
      ).length;
      writtenByType.set(
        e.action.type,
        (writtenByType.get(e.action.type) ?? 0) + written,
      );
    }
    const lines: string[] = [];
    const say = (s: string) => lines.push(s);

    say(
      `session.json: ${JSON.stringify(meta, (k: string, v: unknown): unknown => (k === "h3Cells" ? `[${String((v as unknown[]).length)} cells]` : v))}`,
    );
    say(`actions: ${String(actions.length)}`);

    const counts = new Map<string, number>();
    for (const a of actions) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
    for (const [type, n] of [...counts].sort((x, y) => y[1] - x[1])) {
      const b = bytesByType.get(type);
      say(
        `  ${String(n).padStart(6)}  ${type}  ${b === undefined ? "" : `${(b.raw / 1e6).toFixed(2)} MB raw, ${(b.stored / 1e6).toFixed(2)} MB in the zip`}`,
      );
    }
    say(`zip: ${(bytes.length / 1e6).toFixed(2)} MB`);
    // What else the zip holds besides the recording's actions (a tour's
    // tour.json and qr/ levels, or only session.json).
    say(
      `entries besides actions/: ${[...sizeOf.keys()].filter((n) => !n.startsWith("actions/")).join(", ")}`,
    );
    const writtenDepth = writtenByType.get("recording/recordDepthSample") ?? 0;
    const writtenAll = [...writtenByType.values()].reduce((s, n) => s + n, 0);
    say(
      `as written since S2: ${String(writtenAll)} bytes of actions, ${String(writtenDepth)} of them depth, ${String(writtenAll - writtenDepth)} the other actions`,
    );

    // The Tour Viewer's own events, in order, with their index.
    say("timeline (tourAuthoring/tourViewing, AR session resets):");
    actions.forEach((a, i) => {
      if (
        a.type.startsWith("tourAuthoring/") ||
        a.type.startsWith("tourViewing/") ||
        a.type === "gpsData/resetGpsSessionData" ||
        a.type === "recording/startSession"
      ) {
        const p = a.payload as Record<string, unknown> | undefined;
        const keys = p === undefined ? "" : Object.keys(p).join(",");
        say(`  #${String(i).padStart(6)} ${a.type} {${keys}}`);
      }
    });

    // Visits: split at each GPS reset (an AR exit wipes the store's GPS).
    const visits: Fix[][] = [[]];
    for (const a of actions) {
      if (a.type === "gpsData/resetGpsSessionData") visits.push([]);
      visits[visits.length - 1]!.push(...fixesOf(a));
    }
    visits
      .filter((v) => v.length > 0)
      .forEach((fixes, i) => {
        const acc = fixes.flatMap((f) =>
          typeof f.latLongAccuracy === "number" ? [f.latLongAccuracy] : [],
        );
        let extent = 0;
        let walked = 0;
        for (let j = 1; j < fixes.length; j += 1) {
          walked += metresBetween(fixes[j - 1]!, fixes[j]!);
          extent = Math.max(extent, metresBetween(fixes[0]!, fixes[j]!));
        }
        const seconds =
          fixes.length > 1 &&
          typeof fixes[0]!.timestamp === "number" &&
          typeof fixes.at(-1)!.timestamp === "number"
            ? ((fixes.at(-1)!.timestamp ?? 0) - (fixes[0]!.timestamp ?? 0)) /
              1000
            : Number.NaN;
        say(
          `visit ${String(i)}: ${String(fixes.length)} fixes over ${seconds.toFixed(0)} s, accuracy p50 ${quantile(acc, 0.5).toFixed(1)} m p90 ${quantile(acc, 0.9).toFixed(1)} m, farthest from start ${extent.toFixed(0)} m, walked ${walked.toFixed(0)} m`,
        );
      });

    // What each of the Tour Viewer's own events carried, in numbers.
    const t0 = Date.parse(String(meta?.startedAt));
    const at = (p: { atMs?: number }) =>
      typeof p.atMs === "number"
        ? `t+${((p.atMs - t0) / 1000).toFixed(0)}s`
        : "t?";
    const geoOf = (o: unknown) =>
      (o as { geo?: { lat: number; lon: number; alt: number } } | undefined)
        ?.geo;
    const geoDist = (
      a: { lat: number; lon: number } | undefined,
      b: { lat: number; lon: number } | undefined,
    ) =>
      a === undefined || b === undefined
        ? Number.NaN
        : metresBetween(
            { latitude: a.lat, longitude: a.lon },
            { latitude: b.lat, longitude: b.lon },
          );
    let firstLevelGeo: { lat: number; lon: number } | undefined;
    let firstRotation: number[] | undefined;
    let lastLevelGeo: { lat: number; lon: number } | undefined;
    type GeoPose = {
      lat: number;
      lon: number;
      alt?: number;
      rotation?: number[];
    };
    let firstLevel: GeoPose | undefined;
    let lastLevel: GeoPose | undefined;
    /** An object's position in a code's own frame (metres, the code's
     *  axes): what a visitor who locks that code sees, independent of where
     *  GPS put the code. NUE offset, then the inverse of the code's
     *  rotation. */
    const inCodeFrame = (code: GeoPose, obj: GeoPose): Vector3 => {
      const n = (obj.lat - code.lat) * 111_320;
      const e =
        (obj.lon - code.lon) * 111_320 * Math.cos((code.lat * Math.PI) / 180);
      const u = (obj.alt ?? 0) - (code.alt ?? 0);
      const r = code.rotation ?? [0, 0, 0, 1];
      const q = new Quaternion(r[0], r[1], r[2], r[3]).invert();
      return new Vector3(n, u, e).applyQuaternion(q);
    };
    say("events in detail:");
    for (const a of actions) {
      const p = a.payload as Record<string, unknown>;
      // A viewing session's decisions (the 2026-10-10 viewer recording):
      // everything but the bulky matrices and level text; the per-vote
      // stream is summarised by its first and last entries elsewhere.
      if (
        a.type.startsWith("tourViewing/") &&
        a.type !== "tourViewing/votesCast"
      ) {
        const brief = Object.fromEntries(
          Object.entries(p).filter(
            ([k]) => !["alignmentMatrix", "level", "qrPoseWorld"].includes(k),
          ),
        );
        say(`  ${a.type} ${JSON.stringify(brief).slice(0, 700)}`);
      }
      if (a.type === "tourAuthoring/codeMeasured") {
        const level = JSON.parse(String(p.levelJson)) as {
          qr?: {
            geo?: {
              lat: number;
              lon: number;
              headingDeg?: number;
              rotation?: number[];
            };
            physicalSizeM?: number;
          };
        };
        firstLevelGeo ??= level.qr?.geo;
        firstRotation ??= level.qr?.geo?.rotation;
        lastLevelGeo = level.qr?.geo;
        firstLevel ??= level.qr?.geo;
        lastLevel = level.qr?.geo;
        // The whole turn between this measurement's orientation and the
        // first one's: 2 acos |q1 . q2|.
        const r = level.qr?.geo?.rotation;
        const turnDeg =
          r === undefined || firstRotation === undefined
            ? Number.NaN
            : (2 *
                Math.acos(
                  Math.min(
                    1,
                    Math.abs(
                      r.reduce((s, v, i) => s + v * firstRotation![i]!, 0),
                    ),
                  ),
                ) *
                180) /
              Math.PI;
        say(
          `  codeMeasured ${at(p)} size ${String(p.sizeM)} m kept=${String(p.kept)} replaced=${p.replaced === undefined ? "no" : "yes"} level ${String(p.levelId).slice(0, 8)} alignment ${JSON.stringify(p.alignment)} level geo ${geoDist(firstLevelGeo, level.qr?.geo).toFixed(2)} m and ${turnDeg.toFixed(1)} deg from the first, heading ${String(level.qr?.geo?.headingDeg)}`,
        );
      } else if (a.type === "tourAuthoring/objectMoved") {
        const refused = p.refusedCorrection as { reason?: string } | null;
        say(
          `  objectMoved ${at(p)} ${String((p.after as { kind?: string }).kind)} ${String((p.after as { id?: string }).id)} moved ${geoDist(geoOf(p.before), geoOf(p.after)).toFixed(2)} m basis=${JSON.stringify(p.basis)} refused=${refused === null ? "none" : JSON.stringify(refused)}`,
        );
      } else if (a.type === "tourAuthoring/objectPlaced") {
        const o = p.object as { kind?: string; id?: string };
        say(
          `  objectPlaced ${at(p)} ${String(o.kind)} ${String(o.id)} code in view=${p.code === null ? "no" : "yes"} reticle=${p.reticleOdomNue === null ? "none" : "yes"}`,
        );
      } else if (a.type === "tourAuthoring/settled") {
        const objects = (p.objects ?? []) as {
          id?: string;
          before?: unknown;
          after?: unknown;
          geo?: unknown;
        }[];
        say(
          `  settled ${at(p)} trigger=${String(p.trigger)} basis=${JSON.stringify(p.basis)} refused=${JSON.stringify(p.refusedCorrection)} objects=${String(objects.length)} keys=${objects[0] === undefined ? "" : Object.keys(objects[0]).join(",")} levelAlignment=${JSON.stringify(p.levelAlignment)}`,
        );
        // The correction the code made to the visit's own (GPS) alignment:
        // the summary map draws the visit's AR path (the cyan "fused"
        // track) through the alignment the objects settled through, so a
        // code-corrected visit's path is pinned to the code's STORED pose -
        // its turn here is how far that path is turned against the GPS.
        const visitM = (p.visitAlignment ?? null) as number[] | null;
        const usedM = (p.usedAlignment ?? null) as number[] | null;
        if (visitM !== null && usedM !== null) {
          const yaw = (m: readonly number[]) => Math.atan2(m[8]!, m[0]!);
          let turn = ((yaw(usedM) - yaw(visitM)) * 180) / Math.PI;
          turn = ((((turn + 180) % 360) + 360) % 360) - 180;
          say(
            `    used alignment vs the visit's own: turned ${turn.toFixed(1)} deg, translation ${Math.hypot(usedM[12]! - visitM[12]!, usedM[14]! - visitM[14]!).toFixed(2)} m (horizontal, at the odometry origin)`,
          );
        }
        // Each object's own alignment against the visit's and the code's.
        if (visitM !== null && usedM !== null) {
          const yawOf = (m: readonly number[]) => Math.atan2(m[8]!, m[0]!);
          const deg = (r: number) =>
            (((((r * 180) / Math.PI + 180) % 360) + 360) % 360) - 180;
          for (const s of objects) {
            const m = (s as { usedAlignment?: number[] }).usedAlignment;
            if (m === undefined) continue;
            say(
              `    ${String(s.id)} own alignment: ${deg(yawOf(m) - yawOf(visitM)).toFixed(1)} deg from the visit's, ${deg(yawOf(m) - yawOf(usedM)).toFixed(1)} deg from the code-corrected one; refused ${JSON.stringify((s as { refusedCorrection?: unknown }).refusedCorrection)}`,
            );
          }
        }
        const ref = p.referenceLevel as {
          qr?: { geo?: { headingDeg?: number } };
        } | null;
        const lvl = p.level as {
          qr?: { geo?: { headingDeg?: number } };
        } | null;
        say(
          `    the stored code's heading ${String(ref?.qr?.geo?.headingDeg)}, the settle's level heading ${String(lvl?.qr?.geo?.headingDeg)}`,
        );
        say(
          `    codePositions ${JSON.stringify(p.codePositions)} codeSpots ${JSON.stringify(p.codeSpots)} codePosition ${JSON.stringify(p.codePosition)}`,
        );
        // Did each object settle through the same alignment as the code
        // (then code and objects stay physically consistent)? Largest
        // entry difference between the matrices.
        const levelMatrix = (p.levelAlignment ?? null) as number[] | null;
        for (const s of objects) {
          const m = (s as { usedAlignment?: number[] }).usedAlignment;
          const diff =
            m === undefined || levelMatrix === null
              ? Number.NaN
              : Math.max(
                  ...m
                    .slice(0, 12)
                    .map((v, i) => Math.abs(v - levelMatrix[i]!)),
                );
          say(
            `    ${String(s.id)} usedAlignment vs the code's (levelAlignment): max rotation-entry difference ${diff.toExponential(2)}, translation ${m === undefined || levelMatrix === null ? "?" : Math.hypot(m[12]! - levelMatrix[12]!, m[13]! - levelMatrix[13]!, m[14]! - levelMatrix[14]!).toFixed(2)} m, yaw ${m === undefined || levelMatrix === null ? "?" : (((Math.atan2(m[8]!, m[0]!) - Math.atan2(levelMatrix[8]!, levelMatrix[0]!)) * 180) / Math.PI).toFixed(1)} deg`,
          );
        }
        // How far the settle moved each object from where the creator
        // last left it (its last move, or its placement).
        for (const s of objects) {
          const last = [...actions].reverse().find((b) => {
            const q = b.payload as {
              after?: { id?: string };
              object?: { id?: string };
            };
            return (
              (b.type === "tourAuthoring/objectMoved" &&
                q.after?.id === s.id) ||
              (b.type === "tourAuthoring/objectPlaced" && q.object?.id === s.id)
            );
          });
          const q = last?.payload as
            { after?: unknown; object?: unknown } | undefined;
          say(
            `    ${String(s.id)}: settled ${geoDist(geoOf(q?.after ?? q?.object), geoOf(s)).toFixed(2)} m from where it was left, ${geoDist(lastLevelGeo, geoOf(s)).toFixed(1)} m from the code, basis=${JSON.stringify((s as { basis?: unknown }).basis)}; in the code's own frame it moved ${
              firstLevel === undefined ||
              lastLevel === undefined ||
              geoOf(q?.after ?? q?.object) === undefined ||
              geoOf(s) === undefined
                ? "?"
                : inCodeFrame(
                    firstLevel,
                    geoOf(q?.after ?? q?.object) as GeoPose,
                  )
                    .distanceTo(inCodeFrame(lastLevel, geoOf(s) as GeoPose))
                    .toFixed(2)
            } m`,
          );
        }
      } else if (a.type === "tourAuthoring/finished") {
        const m = p.manifest as {
          version?: number;
          minor?: number;
          title?: string;
          objects?: { kind?: string }[];
          stations?: unknown[];
          assets?: unknown[];
          captureSpots?: unknown;
        };
        const kinds = (m.objects ?? []).map((o) => o.kind).join(",");
        say(
          `  finished ${at(p)} manifest v${String(m.version)}.${String(m.minor)} title=${m.title === undefined ? "none" : "yes"} objects=[${kinds}] stations=${String(m.stations?.length ?? 0)} assets=${String(m.assets?.length ?? 0)} captureSpots=${m.captureSpots === undefined ? "none" : "yes"}`,
        );
      }
    }
    const detections = actions.filter(
      (a) => a.type === "qrDetected/recordQrDetection",
    );
    const first = detections[0]?.payload as Record<string, unknown> | undefined;
    say(
      `qr detection payload keys: ${first === undefined ? "" : Object.keys(first).join(",")}`,
    );
    const reprojection = detections.flatMap((a) => {
      const v = (a.payload as { reprojectionErrorPx?: unknown })
        .reprojectionErrorPx;
      return typeof v === "number" ? [v] : [];
    });
    say(
      `qr detections: ${String(detections.length)}, reprojection px p50 ${quantile(reprojection, 0.5).toFixed(2)} p90 ${quantile(reprojection, 0.9).toFixed(2)}`,
    );

    // How far the author had WALKED at each event, as the settle counts it
    // (the odometry path over the device fixes, `walked-distance-tracker`):
    // the settle corrects an object through a sighting of the code only
    // within `CODE_EVENT_REACH_M` walked of it (D33). Replayed through the
    // page's own store and tracker.
    const store = createTourViewerStore();
    const walked = createWalkedDistanceTracker();
    const walkedAt = (): number => {
      const s = store.getState();
      return walked.update({
        gpsPositions: selectGpsPositions(s),
        odometryPositions: selectOdometryPositions(s),
      });
    };
    say("walked (m) at each event, replayed through the store:");
    let lastDetectionSaid = Number.NEGATIVE_INFINITY;
    for (const a of actions) {
      try {
        store.dispatch(a as never);
      } catch {
        // An action the store refuses changes nothing here.
      }
      const p = a.payload as { atMs?: number; timestamp?: number } | undefined;
      if (
        a.type.startsWith("tourAuthoring/") ||
        a.type === "gpsData/resetGpsSessionData" ||
        a.type === "qrDetected/clearQrMarker"
      ) {
        say(`  ${a.type} walked ${walkedAt().toFixed(1)}`);
      } else if (a.type === "qrDetected/recordQrDetection") {
        const w = walkedAt();
        // One line per 5 m walked while the code is in view.
        if (w - lastDetectionSaid >= 5) {
          lastDetectionSaid = w;
          say(
            `  code detection walked ${w.toFixed(1)} t=${String(p?.timestamp)}`,
          );
        }
      }
    }

    // stdout, not console: the package's test config keeps console quiet.
    process.stdout.write(`${lines.map((l) => `TR ${l}`).join("\n")}\n`);
    expect(actions.length).toBeGreaterThan(0);
  }, 300_000);
});

const TOUR_ZIP = process.env.TOUR_ZIP;

interface TourObjectLike {
  readonly id: string;
  readonly geo?: { lat: number; lon: number };
}

/** Metres east and north of `from` (equirectangular; tens of metres). */
function enOf(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): { e: number; n: number } {
  return {
    e: (to.lon - from.lon) * 111_320 * Math.cos((from.lat * Math.PI) / 180),
    n: (to.lat - from.lat) * 111_320,
  };
}

/** The tour zip at `path`, read as the viewer reads it. */
async function readTourZip(path: string) {
  if (!existsSync(path)) {
    throw new Error(`TOUR_ZIP does not name a file: ${path}`);
  }
  const bytes = new Uint8Array(readFileSync(path));
  const names = (await readZipEntries(bytes)).map((e) => e.filename);
  const manifestName = tourManifestEntryOf(names);
  if (manifestName === null) throw new Error("the zip has no tour.json");
  const [manifestEntry] = await loadEntriesFromSubdirOrRoot(
    bytes,
    manifestName,
  );
  if (manifestEntry === undefined) throw new Error("tour.json unreadable");
  // Its pins and photos in the world (version 3 keeps them in stations).
  const manifest = withWorldObjects(
    parseTourManifest(JSON.parse(await manifestEntry.getText()) as unknown),
  );
  const levels = await Promise.all(
    (await loadEntriesFromSubdir(bytes, "qr")).map(async (e) => ({
      name: e.relativePath,
      geo: storedGeo(await e.getText()),
    })),
  );
  return { names, manifest, levels, code: levels[0]?.geo ?? null };
}

/** "N m from the code, bearing B deg". */
function fromCode(
  code: { lat: number; lon: number },
  geo: { lat: number; lon: number },
): string {
  const at = enOf(code, geo);
  const bearing = ((Math.atan2(at.e, at.n) * 180) / Math.PI + 360) % 360;
  return `${Math.hypot(at.e, at.n).toFixed(1)} m from the code, bearing ${bearing.toFixed(0)} deg`;
}

// Why these tests exist: the zip a Finish saved is what the owner uploads,
// so it is read the way the viewer reads it - the framework's zip reader
// and manifest parser - with each object's place relative to the code,
// and held to the recording's own record of the Finish
// (`tourAuthoring/finished`). `TOUR_ZIP=<zip>`, alone or with
// `TOUR_RECORDING`.
describe.skipIf(TOUR_ZIP === undefined)("a Tour Viewer tour zip", () => {
  it("reads, and reports each object relative to the code", async () => {
    const zip = await readTourZip(String(TOUR_ZIP));
    const lines = [`entries: ${zip.names.join(", ")}`];
    for (const l of zip.levels) {
      lines.push(
        `code ${l.name}: heading ${String(l.geo?.headingDeg)} lat ${String(l.geo?.lat)} lon ${String(l.geo?.lon)}`,
      );
    }
    for (const o of zip.manifest.objects) {
      const label = "caption" in o ? String(o.caption) : "";
      const where = zip.code === null ? "" : ` ${fromCode(zip.code, o.geo)}`;
      lines.push(`object ${o.kind} ${o.id} "${label}"${where}`);
    }
    process.stdout.write(`${lines.map((l) => `TZ ${l}`).join("\n")}\n`);
    expect(zip.levels.length).toBeGreaterThan(0);
  });

  it.skipIf(ZIP === undefined)(
    "holds exactly what the recording's Finish logged",
    async () => {
      const zip = await readTourZip(String(TOUR_ZIP));
      const actions = (
        await loadActionsFromZip(new Uint8Array(readFileSync(String(ZIP))))
      ).map((e) => e.action);
      const finished = actions
        .filter((a) => a.type === "tourAuthoring/finished")
        .at(-1);
      const logged = (
        finished?.payload as { manifest?: TourManifest } | undefined
      )?.manifest;
      const recorded = logged === undefined ? undefined : tourObjects(logged);
      expect(
        recorded,
        "the recording logs the Finish's manifest",
      ).toBeDefined();
      expect(JSON.parse(JSON.stringify(zip.manifest.objects))).toEqual(
        recorded,
      );
      // Where each object was when it was left in AR (its place through
      // the GPS alignment of that moment), against where the Finish put it.
      const lines: string[] = [];
      for (const act of actions) {
        const p = act.payload as
          { object?: TourObjectLike; after?: TourObjectLike } | undefined;
        const left =
          act.type === "tourAuthoring/objectPlaced"
            ? p?.object
            : act.type === "tourAuthoring/objectMoved"
              ? p?.after
              : undefined;
        if (left?.geo === undefined || zip.code === null) continue;
        lines.push(
          `left in AR (${act.type.split("/")[1]!}) ${left.id}: ${fromCode(zip.code, left.geo)}`,
        );
      }
      process.stdout.write(`${lines.map((l) => `TZ ${l}`).join("\n")}\n`);
    },
  );
});

// Why this test exists (field test 3, the owner's question): the rule was
// tested at the recording's numbers, not on its Finish. This replays that
// Finish's settle from the recording through the production planners -
// the stored code, the end alignment, the latest sighting and the zero the
// settled log carries, and each object's last AR pose - twice: as it ran
// (the code kept, no pick quality: the old path), which must reproduce the
// tour zip, and as today's rules decide it.
//
// What the replay cannot know (the picks are not logged): each object's
// own pick and the earlier sightings. The visit's GPS spread never reached
// the 40 m at which a pick matures, so every pick fell back to the end
// alignment, and the one logged sighting stands for all of them; the "as
// it ran" check measures what that costs.
/** What a replay expects of today's rules, opted into per recording:
 *  `replace` - the stored code is replaced and every pin keeps its distance
 *  from it (the 2026-10-09 recording, field test 3). */
const REPLAY_EXPECT = process.env.TOUR_REPLAY_EXPECT;

/** The replay's outcome under today's rules, for the expectation test. */
let replayed: {
  readonly decisionKind: string;
  readonly reminted: boolean;
  readonly pins: readonly {
    readonly label: string;
    readonly basis: string;
    /** From the new code (m). */
    readonly fromNewCodeM: number;
    /** The zip's pin from the stored code (m). */
    readonly zipFromStoredCodeM: number;
  }[];
} | null = null;

describe.skipIf(ZIP === undefined || TOUR_ZIP === undefined)(
  "a field recording's Finish, replayed with today's rules",
  () => {
    it("reproduces the zip as it ran, then settles the code and the pins by today's rules", async () => {
      // The geodesy is licence-gated; building a store activates it, as
      // the page does at boot.
      createTourViewerStore();
      const zip = await readTourZip(String(TOUR_ZIP));
      const actions = (
        await loadActionsFromZip(new Uint8Array(readFileSync(String(ZIP))))
      ).map((e) => e.action);
      const settled = actions
        .filter((a) => a.type === "tourAuthoring/settled")
        .at(-1)?.payload as
        | {
            arVisitIndex: number;
            atMs: number;
            visitAlignment: number[];
            sighting: CodeSighting | null;
            referenceLevel: { id: string; json: string } | null;
            zero: { lat: number; lon: number };
            codePosition?: {
              candidate: { extentM: number | null; accuracyM: number | null };
            };
          }
        | undefined;
      expect(settled?.referenceLevel, "the Finish's stored code").toBeTruthy();
      expect(settled?.sighting, "the Finish's latest sighting").toBeTruthy();
      const s = settled!;
      const level = s.referenceLevel!;
      const sighting = s.sighting!;
      // Each object's last pose in AR.
      const lastPose = new Map<
        string,
        { object: TourObject; local: [number, number, number]; atMs: number }
      >();
      for (const a of actions) {
        const p = a.payload as {
          object?: TourObject;
          after?: TourObject;
          reticleOdomNue?: [number, number, number] | null;
          atMs?: number;
        };
        const object =
          a.type === "tourAuthoring/objectPlaced"
            ? p.object
            : a.type === "tourAuthoring/objectMoved"
              ? p.after
              : undefined;
        if (object === undefined || !p.reticleOdomNue) continue;
        lastPose.set(object.id, {
          object,
          local: p.reticleOdomNue,
          atMs: p.atMs ?? 0,
        });
      }
      const placed = zip.manifest.objects.flatMap((o) => {
        const pose = lastPose.get(o.id);
        return pose === undefined
          ? []
          : [
              {
                object: pose.object,
                placement: {
                  visit: s.arVisitIndex,
                  local: {
                    position: pose.local,
                    rotation: [0, 0, 0, 1] as [number, number, number, number],
                  },
                },
              },
            ];
      });
      expect(placed).toHaveLength(zip.manifest.objects.length);
      const picks = {
        objects: new Map(
          [...lastPose].map(([id, p]) => [
            id,
            { atMs: p.atMs, alignment: null },
          ]),
        ),
        measurement: null,
        sightings: [{ atMs: s.atMs, alignment: null, sighting }],
      };
      const candidate = s.codePosition!.candidate;
      const base = {
        visit: s.arVisitIndex,
        placed,
        alignment: s.visitAlignment,
        zero: s.zero,
        mintedLevel: level,
        sighting,
        alignmentInfo: {
          hasMatrix: true,
          sampleCount: 100,
          gpsAccuracyM: candidate.accuracyM ?? 5,
        },
        gpsAccuracyM: candidate.accuracyM,
        nowIso: "2026-10-09T12:20:00.000Z",
      };
      const storedCode = storedGeo(level.json)!;
      const lines: string[] = [];
      const label = (o: TourObject) =>
        "caption" in o && o.caption !== undefined ? o.caption : o.id;
      const metres = (a: { lat: number; lon: number }, b: typeof a) => {
        const d = enOf(a, b);
        return Math.hypot(d.e, d.n);
      };

      // As it ran: the code kept, every object corrected through it.
      const asRan = planVisitSettle({ ...base, measurement: null, picks })!;
      for (const o of asRan.objects) {
        const inZip = zip.manifest.objects.find((z) => z.id === o.object.id)!;
        lines.push(
          `as it ran: ${label(o.object)} ${o.basis}, ${fromCode(storedCode, o.object.geo)}; ${metres(inZip.geo, o.object.geo).toFixed(2)} m from the zip`,
        );
        expect(metres(inZip.geo, o.object.geo), label(o.object)).toBeLessThan(
          1,
        );
      }

      // Today's rules.
      const position = planCodePosition({
        visit: s.arVisitIndex,
        mintedLevel: level,
        measurement: null,
        sighting,
        picks,
        alignment: s.visitAlignment,
        zero: s.zero,
        endQuality: candidate,
        sizeM: storedSizeM(level.json) ?? 0.16,
      });
      expect(position, "a decision for the stored code").not.toBeNull();
      lines.push(
        `today: code ${JSON.stringify(position!.decision)}, offset ${position!.offsetM.toFixed(2)} m`,
      );
      const todayInput = {
        ...base,
        measurement: position!.measurement,
        picks: { ...picks, measurement: position!.pick },
      };
      const today = planVisitSettle(todayInput)!;
      const newCode =
        today.level === null ? storedCode : storedGeo(today.level.json)!;
      lines.push(
        `today: code heading ${String(storedCode.headingDeg?.toFixed(1))} -> ${String(newCode.headingDeg?.toFixed(1))}, moved ${metres(storedCode, newCode).toFixed(2)} m`,
      );
      // The result map draws the visit's path through the end choice.
      const end = visitEndChoice(todayInput);
      lines.push(
        `today: the map's path ${String(end?.basis)}, turned ${end === null ? "?" : alignmentTurnDeg(end.alignment, s.visitAlignment).toFixed(1)} deg from the visit's GPS`,
      );
      for (const o of today.objects) {
        const left = lastPose.get(o.object.id)!.object.geo;
        lines.push(
          `today: ${label(o.object)} ${o.basis}, ${fromCode(storedCode, o.object.geo)} (old code), ${fromCode(newCode, o.object.geo)} (new code); ${metres(left, o.object.geo).toFixed(2)} m from where it was left in AR`,
        );
      }
      lines.push(
        `today's result line: ${codePositionSentence([{ decision: position!.decision, applied: today.level !== null }])}`,
      );
      process.stdout.write(`${lines.map((l) => `TS ${l}`).join("\n")}\n`);
      replayed = {
        decisionKind: position!.decision.kind,
        reminted: today.level !== null,
        pins: today.objects.map((o) => ({
          label: label(o.object),
          basis: o.basis,
          fromNewCodeM: metres(newCode, o.object.geo),
          zipFromStoredCodeM: metres(
            storedCode,
            zip.manifest.objects.find((z) => z.id === o.object.id)!.geo,
          ),
        })),
      };
    });

    // Why (field test 3, the milestone review of M0a #4): the replay's
    // claims about today's rules were printed, not held - a regression back
    // to keeping the code would have stayed green. With
    // TOUR_REPLAY_EXPECT=replace (the 2026-10-09 recording) they are held:
    // the code is replaced, every pin settles through the visit's own
    // alignment, and the layout around the code is the zip's, turned back.
    it.skipIf(REPLAY_EXPECT !== "replace")(
      "holds today's rules to the recording's expectation",
      () => {
        expect(replayed, "the replay ran first").not.toBeNull();
        const r = replayed!;
        expect(r.decisionKind).toBe("replace");
        expect(r.reminted).toBe(true);
        for (const pin of r.pins) {
          expect(pin.basis, pin.label).toBe("measured-here");
          expect(
            Math.abs(pin.fromNewCodeM - pin.zipFromStoredCodeM),
            pin.label,
          ).toBeLessThan(0.3);
        }
      },
    );
  },
);

// Why this test exists (polish round C5, the M0a milestone review #6): the
// re-judged veto's factor had never met real data. A viewing recording that
// was vetoed (2026-10-10) is replayed through the store with the moved-code
// check running beside it under the rule that vetoed it (no heading-evidence
// gate) and each restore factor, and under today's rule. It reports when
// each variant vetoes and lifts; it pins only that the replay ran.
describe.skipIf(ZIP === undefined)(
  "a viewing recording's moved-code check, replayed under old and new rules",
  () => {
    it("reports when each rule vetoes and lifts", async () => {
      const store = createTourViewerStore();
      const actions = (
        await loadActionsFromZip(new Uint8Array(readFileSync(String(ZIP))))
      ).map((e) => e.action);
      expect(actions.length).toBeGreaterThan(0);
      const oldTurn = { ...CODE_TURN_RULE, sigmaFactor: 0 };
      const variants = [
        ...[1.5, 2, 3].map((factor) => ({
          label: `old turn rule (k 0), restore x${String(factor)}`,
          rules: { move: CODE_MOVE_RULE, turn: oldTurn },
          factor,
        })),
        {
          label: "today's rule (k 3), restore x2",
          rules: undefined,
          factor: 2,
        },
      ].map((v) => {
        const events: string[] = [];
        let nowS = 0;
        const checks = createMovedCodeChecks({
          rules: v.rules,
          restoreSpreadFactor: v.factor,
          onRestored: (r) => {
            events.push(
              `lifted at +${nowS.toFixed(0)} s (spread ${r.evidence.spreadM.toFixed(1)} m, vetoed on ${r.evidence.vetoSpreadM.toFixed(1)} m)`,
            );
          },
        });
        return {
          ...v,
          checks,
          events,
          setNow: (s: number) => {
            nowS = s;
          },
        };
      });
      let pinnedAtMs: number | null = null;
      for (const a of actions) {
        store.dispatch(a as never);
        const p = a.payload as {
          text?: string;
          /** The level's `qr` block (`CodeLockedLog`). */
          level?: QrLevel["qr"] | null;
          qrPoseWorld?: Pose;
          atMs?: number;
          rawGpsPoint?: { timestamp?: number };
          events?: { rawGpsPoint?: { timestamp?: number } }[];
        };
        if (
          pinnedAtMs === null &&
          a.type === "tourViewing/codeLocked" &&
          p.level !== undefined &&
          p.level !== null &&
          p.qrPoseWorld !== undefined &&
          p.text !== undefined &&
          p.atMs !== undefined
        ) {
          pinnedAtMs = p.atMs;
          const zero = selectZeroReference(store.getState());
          for (const v of variants) {
            v.checks.pin({
              text: p.text,
              levelId: "replayed",
              level: { version: 1, qr: p.level },
              qrPoseWorld: p.qrPoseWorld,
              atMs: p.atMs,
              zero,
            });
          }
        }
        if (pinnedAtMs === null || !a.type.startsWith("gpsData/recordGps"))
          continue;
        const stamp =
          p.rawGpsPoint?.timestamp ?? p.events?.at(-1)?.rawGpsPoint?.timestamp;
        if (stamp === undefined) continue;
        const state = store.getState();
        const history = {
          gpsPositions: selectGpsPositions(state),
          odometryPositions: selectOdometryPositions(state),
          zero: selectZeroReference(state),
        };
        for (const v of variants) {
          v.setNow((stamp - pinnedAtMs) / 1000);
          for (const verdict of v.checks.update(history, stamp)) {
            v.events.push(
              `vetoed at +${verdict.evidence.sinceScanS.toFixed(0)} s by ${verdict.evidence.decidedBy} (yaw ${verdict.evidence.yawDeg.toFixed(1)}, spread ${verdict.evidence.spreadM.toFixed(1)} m, accuracy ${String(verdict.evidence.deviceAccuracyMedianM)})`,
            );
          }
        }
      }
      const lines = variants.map(
        (v) =>
          `${v.label}: ${v.events.length === 0 ? "no veto" : v.events.join("; ")}`,
      );
      process.stdout.write(`${lines.map((l) => `TV ${l}`).join("\n")}\n`);
    }, 300_000);
  },
);

/** The manifest entry's text reader, wherever in the zip it sits. */
async function loadEntriesFromSubdirOrRoot(
  bytes: Uint8Array,
  name: string,
): Promise<{ getText: () => Promise<string> }[]> {
  const slash = name.lastIndexOf("/");
  if (slash > 0) {
    const found = await loadEntriesFromSubdir(bytes, name.slice(0, slash));
    return found.filter((e) => e.fullPath === name);
  }
  const entry = (await readZipEntries(bytes)).find((e) => e.filename === name);
  if (entry === undefined || entry.directory) return [];
  return [{ getText: () => entry.getData(new TextWriter()) }];
}
