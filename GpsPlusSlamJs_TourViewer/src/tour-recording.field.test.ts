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
import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  loadActionsFromZip,
  readZipEntries,
  type RecordedAction,
} from "gps-plus-slam-app-framework/storage";
import { loadSessionMetadata } from "gps-plus-slam-app-framework/storage/zip-reader";

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

    // stdout, not console: the package's test config keeps console quiet.
    process.stdout.write(`${lines.map((l) => `TR ${l}`).join("\n")}\n`);
    expect(actions.length).toBeGreaterThan(0);
  }, 300_000);
});
