/**
 * QR-first M0 (plan 2026-10-14-0445, §3 M0, §7 #1-#8): the replay
 * instrument on a REAL Tour Viewer visitor recording, opt-in.
 *
 * `QR_HOLD_REPLAY=recording pnpm run test:unit src/qr-hold-replay.recordings.test.ts`
 * (the recording: `QR_HOLD_ZIP=<zip>`, default the 2026-10-10 visitor
 * session in the primary repo's `TestDataJs-Other/tour-viewer/`, the only
 * one of the four that ran the viewer's vote path). Without the variable
 * every test here is skipped: the recordings hold the owner's GPS track and
 * live only in the private repo. Nothing is unzipped by hand: the
 * framework's zip reader does the reading.
 *
 * Why this file matters: before any lever of M2 is judged on a field
 * recording, the replay must be shown to BE the phone - first the store
 * against the alignment the phone logged, then the regenerated votes
 * against the recorded ones at today's values. Only then does it attribute
 * the re-sighting residual to GPS pull or odometry drift, across the knobs.
 * It prints `QRH` lines; the dated results doc carries the reading.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFusedQrPoseSource } from "gps-plus-slam-app-framework/ar/qr/qr-fused-pose-source";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import {
  selectAlignmentMatrix,
  selectQrFusedEntries,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import { loadActionsFromZip } from "gps-plus-slam-app-framework/storage/zip-reader";

import { createTourViewerStore } from "./tour-viewer-session.js";
import {
  createReplayStore,
  poseNoiseFloor,
  replayVotePath,
  resightingSplit,
  TODAY_KNOBS,
  type VotePathKnobs,
} from "./test-support/qr-hold-replay.js";
import {
  buildScenario,
  SCENARIO_CODE_GEO,
  type ScenarioParams,
} from "./test-support/qr-hold-scenario.js";
import {
  CACHE_DIR,
  COLLISION_RULE,
  dayOf,
  loadWalks,
  markSites,
  nameCollisions,
  nueOdom,
  nueToOtherZero,
  pairId,
  usableMarks,
  type Obs,
  type Walk,
} from "./test-support/real-walks.js";
import { throughAlignment } from "./visit-anchoring.js";
import {
  parseViewerRecording,
  type ParsedRecording,
  type RecordedAction,
} from "./test-support/qr-hold-recording.js";

const MODE = process.env.QR_HOLD_REPLAY;
const PRIMARY =
  process.env.D20_REAL_PRIMARY ??
  path.resolve(import.meta.dirname, "../../../gps-plus-slam");
const ZIP =
  process.env.QR_HOLD_ZIP ??
  `${PRIMARY}/TestDataJs-Other/tour-viewer/tour-recording-2026-10-10_22-40-14utc.zip`;

// The core's geodesy is licence-gated; a store activates it.
createTourViewerStore();

const say = (lines: readonly string[]): void => {
  process.stdout.write(`${lines.map((l) => `QRH ${l}`).join("\n")}\n`);
};
const r2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : "-");
const r3 = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : "-");

async function loadRecording(): Promise<RecordedAction[]> {
  if (!existsSync(ZIP))
    throw new Error(`QR_HOLD_ZIP does not name a file: ${ZIP}`);
  return (await loadActionsFromZip(new Uint8Array(readFileSync(ZIP)))).map(
    (e) => e.action as RecordedAction,
  );
}

const maxAbsDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let m = 0;
  for (let i = 0; i < 16; i += 1) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
};

describe.runIf(MODE === "recording")(
  "QR hold replay on a visitor recording",
  () => {
    let actions: RecordedAction[] = [];
    let parsed: ParsedRecording;

    it("reads the recording into replay events", async () => {
      actions = await loadRecording();
      parsed = parseViewerRecording(actions);
      const kinds = new Map<string, number>();
      for (const e of parsed.events)
        kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
      const lines = [
        `zip ${path.basename(ZIP)}: ${String(actions.length)} actions -> ${String(parsed.events.length)} events ${JSON.stringify(Object.fromEntries(kinds))}`,
        `recorded casts at ${String(parsed.recordedCast.size)} events, ${String(parsed.recordedOverrides.length)} soft-trim switches, ${String(parsed.phoneAlignments.length)} phone alignments`,
        ...parsed.sightings.map(
          (s, i) =>
            `sighting ${String(i)}: ${String(s.lockEvents.length)} locked frames, ${((s.endMs - s.startMs) / 1000).toFixed(1)} s, voted=${String(s.voted)}, at ${String(s.startMs)}`,
        ),
        ...parsed.notes.map((n) => `note: ${n}`),
        "gpsData order:",
        ...actions.flatMap((a, i) =>
          a.type.startsWith("gpsData/") &&
          a.type !== "gpsData/recordGpsEvent" &&
          a.type !== "gpsData/recordGpsEventBatch"
            ? [
                `  #${String(i)} ${a.type} ${String(JSON.stringify(a.payload)).slice(0, 160)}`,
              ]
            : [],
        ),
      ];
      const withCompass = parsed.events.filter(
        (e) =>
          e.kind === "fix" && e.payload.rawAbsoluteOrientation !== undefined,
      ).length;
      const fixes = parsed.events.filter((e) => e.kind === "fix").length;
      lines.push(
        `device fixes ${String(fixes)}, with a compass reading ${String(withCompass)}`,
      );
      say(lines);
      expect(parsed.events.length).toBeGreaterThan(0);
    }, 300_000);

    it("tier 1: the recorded actions, replayed verbatim, reproduce the phone's logged alignment", () => {
      // Why: the store and core in this package must BE the phone's before
      // anything regenerated is compared with it (library 1.26.0 on both).
      const store = createReplayStore();
      const diffs: string[] = [];
      let worst = 0;
      for (const a of actions) {
        if (a.type.startsWith("gpsData/") || a.type.startsWith("qrDetected/")) {
          store.dispatch(a as never);
        }
        if (
          (a.type === "tourViewing/votesCast" ||
            a.type === "tourViewing/placed" ||
            a.type === "tourViewing/codeIgnored") &&
          Array.isArray(
            (a.payload as { alignmentMatrix?: unknown }).alignmentMatrix,
          )
        ) {
          const phone = (a.payload as { alignmentMatrix: number[] })
            .alignmentMatrix;
          const mine = selectAlignmentMatrix(store.getState());
          const d =
            mine === null ? Number.POSITIVE_INFINITY : maxAbsDiff(mine, phone);
          worst = Math.max(worst, d);
          diffs.push(`${a.type.split("/")[1]!} ${d.toExponential(2)}`);
        }
      }
      say([
        `tier 1 (verbatim vs phone), largest matrix entry difference ${worst.toExponential(2)}: ${diffs.join(", ")}`,
      ]);
      expect(worst).toBeLessThan(1e-6);
    }, 300_000);

    it("tier 2 and 3: regenerated votes equal the recorded ones, and the regenerated replay reproduces the phone", () => {
      // Why: the brief's correctness rule. Every synthetic event of the
      // recording was stripped; the engine re-casts them through the
      // production builder, keep-alive and sink at today's values. Arrival
      // latencies are swept because the arrival is estimated (§ header of
      // qr-hold-recording.ts).
      for (const latencyMs of [0, 300, 1000]) {
        const p = parseViewerRecording(actions, { latencyMs });
        const lines: string[] = [];
        let worstPhone = 0;
        const replay = replayVotePath(p.events, TODAY_KNOBS, {
          after: (_e, index, ctx) => {
            for (const snap of p.phoneAlignments) {
              if (snap.afterEvent !== index) continue;
              const mine = selectAlignmentMatrix(ctx.store.getState());
              const d =
                mine === null
                  ? Number.POSITIVE_INFINITY
                  : maxAbsDiff(mine, snap.matrix);
              worstPhone = Math.max(worstPhone, d);
            }
          },
        });
        let equal = 0;
        let countDiffer = 0;
        let valueDiffer = 0;
        const indices = new Set([
          ...p.recordedCast.keys(),
          ...replay.castAt.keys(),
        ]);
        for (const i of indices) {
          const rec = p.recordedCast.get(i) ?? [];
          const gen = replay.castAt.get(i) ?? [];
          if (rec.length === 0 && gen.length === 0) continue;
          if (rec.length !== gen.length) {
            countDiffer += 1;
            if (countDiffer <= 5) {
              const around = p.events
                .slice(Math.max(0, i - 4), i + 3)
                .map((e, k) => {
                  const at =
                    e.kind === "fix"
                      ? `stamp ${String(e.payload.rawGpsPoint.timestamp)} arrival ${String(e.arrivalMs)}`
                      : e.kind === "lock"
                        ? `at ${String(e.atMs)}${e.voted ? " voted" : ""}`
                        : "";
                  return `${String(Math.max(0, i - 4) + k)}:${e.kind} ${at}`;
                })
                .join(" | ");
              lines.push(
                `  event ${String(i)} (${p.events[i]!.kind}): recorded ${String(rec.length)}, regenerated ${String(gen.length)}; around: ${around}`,
              );
            }
            continue;
          }
          if (JSON.stringify(rec) === JSON.stringify(gen)) equal += 1;
          else {
            valueDiffer += 1;
            if (valueDiffer <= 3)
              lines.push(
                `  event ${String(i)}: values differ: ${JSON.stringify(rec[0]).slice(0, 200)} / ${JSON.stringify(gen[0]).slice(0, 200)}`,
              );
          }
        }
        const overrides = replay.dispatched.filter(
          (a) =>
            a.type === "gpsData/setAlignmentOverrides" && a.payload !== null,
        );
        say([
          `tier 2 (latency ${String(latencyMs)} ms): ${String(equal)} casts equal, ${String(countDiffer)} differ in count, ${String(valueDiffer)} in value; soft-trim switches recorded ${String(p.recordedOverrides.length)} ${JSON.stringify(p.recordedOverrides.map((o) => o.payload))}, regenerated ${String(overrides.length)} ${JSON.stringify(overrides.map((o) => o.payload))}`,
          ...lines,
          `tier 3 (latency ${String(latencyMs)} ms): regenerated replay vs phone, largest matrix entry difference ${worstPhone.toExponential(2)}`,
        ]);
        expect(countDiffer + valueDiffer).toBe(0);
        expect(worstPhone).toBeLessThan(1e-6);
      }
    }, 900_000);

    it("attributes each re-sighting's residual to GPS pull or odometry drift, across the knobs", () => {
      // Why: the M0 question. Parameters declared and swept (owner rule
      // 2026-09-13); every arm keeps the recorded lock schedule.
      const arms: [string, VotePathKnobs][] = [
        ["today, veto as recorded", TODAY_KNOBS],
        ["today, no veto (today's rule)", { ...TODAY_KNOBS, veto: "none" }],
        ["GPS ignored, no veto", { ...TODAY_KNOBS, veto: "none", gps: "off" }],
        [
          "hard trim, no veto",
          { ...TODAY_KNOBS, veto: "none", softTrim: null },
        ],
        [
          "compass off, no veto",
          { ...TODAY_KNOBS, veto: "none", compass: "off" },
        ],
        ...[10, 30].map((b): [string, VotePathKnobs] => [
          `compass bias ${String(b)} deg, no veto`,
          { ...TODAY_KNOBS, veto: "none", compassBiasDeg: b },
        ]),
        ...[60_000, 240_000].map((h): [string, VotePathKnobs] => [
          `hold ${String(h / 1000)} s, no veto`,
          { ...TODAY_KNOBS, veto: "none", holdMs: h },
        ]),
        ...[
          [0.5, 1],
          [1, 5],
          [2, 5],
          [0.1, 1],
        ].map(([exp, acc]): [string, VotePathKnobs] => [
          `accuracy exponent ${String(exp)}, votes at ${String(acc)} m, no veto`,
          {
            ...TODAY_KNOBS,
            veto: "none",
            accuracyExponent: exp!,
            syntheticAccuracyM: acc!,
          },
        ]),
        ...(["reach", "excursion", "path"] as const).map(
          (measure): [string, VotePathKnobs] => [
            `distance hold ${measure} 10 m + fade 20 m, no veto`,
            {
              ...TODAY_KNOBS,
              veto: "none",
              distanceHold: { measure, holdM: 10, fadeM: 20 },
            },
          ],
        ),
      ];
      const zero = parsed.zero;
      expect(zero).not.toBeNull();
      for (const [label, knobs] of arms) {
        say([...resightingReport(parsed, knobs, label)]);
      }
    }, 3_600_000);
  },
);

/** The re-sighting metrics of one arm, as report lines. */
function resightingReport(
  parsed: ParsedRecording,
  knobs: VotePathKnobs,
  label: string,
): string[] {
  const lines: string[] = [];
  const sightingOf = new Map<number, number>();
  parsed.sightings.forEach((s, i) => {
    for (const e of s.lockEvents) sightingOf.set(e, i);
  });
  /** Per sighting: the instant's alignment, kept pose and the fresh poses. */
  const at = new Map<
    number,
    {
      alignment: number[] | null;
      kept: Pose | null;
      keptAtMs: number;
      geoText: string;
      sinceKeptS: number;
      walkedM: number;
      share: number;
      frames: Pose[];
      fused: Pose | null;
      continuous: number[];
    }
  >();
  let fused = createFusedQrPoseSource({
    entriesOf: () => [],
  });
  let pathM = 0;
  let lastPhone: readonly [number, number] | null = null;
  let pathAtKeep = 0;
  let keptAt = Number.NaN;
  const geoOf = new Map<string, unknown>();
  const sizeOf = new Map<string, number>();
  for (const e of parsed.events) {
    if (e.kind === "lock" && e.voted !== undefined && !sizeOf.has(e.text)) {
      sizeOf.set(e.text, e.voted.sizeM);
    }
  }
  replayVotePath(parsed.events, knobs, {
    before: (e, index, ctx) => {
      if (e.kind !== "lock") return;
      const s = sightingOf.get(index);
      // The instant: the sighting's first locked frame, before any of its
      // votes can land.
      if (s === undefined || parsed.sightings[s]!.lockEvents[0] !== index)
        return;
      const kept = ctx.kept();
      if (kept === null || kept.text !== e.text) return;
      const a = selectAlignmentMatrix(ctx.store.getState());
      geoOf.set(e.text, kept.geo);
      at.set(s, {
        alignment: a === null ? null : Array.from(a),
        kept: kept.pose,
        keptAtMs: kept.keptAtMs,
        geoText: e.text,
        sinceKeptS: (e.atMs - kept.keptAtMs) / 1000,
        walkedM: pathM - pathAtKeep,
        share: ctx.holdShare(e.atMs),
        frames: [],
        fused: null,
        continuous: [],
      });
    },
    after: (e, index, ctx) => {
      if (e.kind === "entry") {
        const store = ctx.store;
        fused = createFusedQrPoseSource({
          entriesOf: (text) => selectQrFusedEntries(store.getState(), text),
          optionsFor: (text) => {
            const sizeM = sizeOf.get(text);
            return sizeM === undefined ? {} : { sizeM };
          },
        });
      }
      if (e.kind === "fix") {
        const p = ctx.phone();
        if (p !== null && lastPhone !== null)
          pathM += Math.hypot(p[0] - lastPhone[0], p[1] - lastPhone[1]);
        lastPhone = p;
      }
      const kept = ctx.kept();
      if (kept !== null && kept.keptAtMs !== keptAt) {
        keptAt = kept.keptAtMs;
        pathAtKeep = pathM;
      }
      if (e.kind !== "lock") return;
      const s = sightingOf.get(index);
      const rec = s === undefined ? undefined : at.get(s);
      if (rec === undefined) return;
      rec.frames.push(e.detectionPose);
      if (rec.fused === null) rec.fused = fused.resolve(e.text);
      if (kept !== null) {
        const d = resightingSplit({
          alignment:
            rec.alignment ??
            Array.from(selectAlignmentMatrix(ctx.store.getState()) ?? []),
          fresh: e.detectionPose,
          kept: kept.pose,
          geo: kept.geo,
          zero: selectZeroReference(ctx.store.getState())!,
        });
        rec.continuous.push(d.drift.m);
      }
    },
  });
  const zero = parsed.zero!;
  for (const [s, rec] of at) {
    const sighting = parsed.sightings[s]!;
    if (rec.alignment === null || rec.kept === null) continue;
    // Skip the sighting that kept the pose (its first lock is the keep).
    if (rec.sinceKeptS <= 0) continue;
    const geo = geoOf.get(rec.geoText) as Parameters<
      typeof resightingSplit
    >[0]["geo"];
    const floor = poseNoiseFloor(rec.frames);
    const freshRaw = medianPose(rec.frames);
    for (const [which, fresh] of [
      ["fused", rec.fused],
      ["median", freshRaw],
    ] as const) {
      if (fresh === null) {
        lines.push(
          `${label} | sighting ${String(s)} | ${which}: no stable pose`,
        );
        continue;
      }
      const split = resightingSplit({
        alignment: rec.alignment,
        fresh,
        kept: rec.kept,
        geo,
        zero,
      });
      lines.push(
        `${label} | sighting ${String(s)} (+${rec.sinceKeptS.toFixed(0)} s, ${rec.walkedM.toFixed(1)} m odometry path, hold share ${r2(rec.share)}, ${String(sighting.lockEvents.length)} frames) | fresh=${which} | total ${r3(split.total.m)} m ${r2(split.total.deg)} deg | pull ${r3(split.pull.m)} m ${r2(split.pull.deg)} deg | drift ${r3(split.drift.m)} m ${r2(split.drift.deg)} deg | floor p50 ${r3(floor.p50M)} p90 ${r3(floor.p90M)} m, p90 ${r2(floor.p90Deg)} deg | continuous drift median ${r3(median(rec.continuous))} m`,
      );
    }
  }
  if (at.size === 0) lines.push(`${label} | no re-sighting of a kept code`);
  return lines;
}

function median(v: readonly number[]): number {
  const s = [...v].filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length === 0) return Number.NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** The frame closest to the set's median position (a real pose, so its
 *  rotation is a real one too). */
function medianPose(frames: readonly Pose[]): Pose | null {
  if (frames.length === 0) return null;
  const mx = median(frames.map((f) => f.position[0]));
  const mz = median(frames.map((f) => f.position[2]));
  let best = frames[0]!;
  let bestD = Number.POSITIVE_INFINITY;
  for (const f of frames) {
    const d = Math.hypot(f.position[0] - mx, f.position[2] - mz);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Synthetic arms: the owner's kitchen (QR_HOLD_REPLAY=kitchen) and the
// corpus's real GPS error (QR_HOLD_REPLAY=corpus).
// ---------------------------------------------------------------------------

/** Seconds after the scan at which a perfect witness re-sighting is taken. */
const INSTANTS_S = [30, 60, 120, 180, 240, 300, 420] as const;

interface InstantRow {
  readonly s: number;
  readonly pathM: number;
  readonly share: number;
  readonly split: ReturnType<typeof resightingSplit>;
}

/** One synthetic session through the vote path; a witness re-sighting (the
 *  code measured through the drifted odometry, no votes cast) at each
 *  instant. The kept pose is the engine's. */
function runScenario(
  params: ScenarioParams,
  knobs: VotePathKnobs,
): InstantRow[] {
  const sc = buildScenario(params);
  const rows: InstantRow[] = [];
  const pending = INSTANTS_S.filter((s) => s <= params.afterS).map(
    (s) => s * 1000,
  );
  replayVotePath(sc.events, knobs, {
    after: (e, _i, ctx) => {
      if (e.kind !== "fix" || pending.length === 0) return;
      const sinceMs = e.payload.rawGpsPoint.timestamp - sc.scanMs;
      if (sinceMs < pending[0]!) return;
      pending.shift();
      const a = selectAlignmentMatrix(ctx.store.getState());
      const kept = ctx.kept();
      if (a === null) return;
      const at = e.payload.rawGpsPoint.timestamp;
      rows.push({
        s: Math.round(sinceMs / 1000),
        pathM: sc.pathAt(at),
        share: ctx.holdShare(e.arrivalMs),
        split: resightingSplit({
          alignment: a,
          fresh: sc.freshPoseAt(at),
          // A dropped code would leave the pose measured at the scan.
          kept: kept?.pose ?? sc.freshPoseAt(sc.scanMs),
          geo: SCENARIO_CODE_GEO,
          zero: sc.zero,
        }),
      });
    },
  });
  return rows;
}

const KITCHEN: ScenarioParams = {
  seed: 7,
  preScanS: 15,
  afterS: 420,
  walk: "kitchen",
  speedMps: 0.25,
  gps: {
    kind: "synthetic",
    biasM: 8,
    biasBearingDeg: 60,
    wanderM: 4,
    wanderTauS: 60,
    whiteM: 2,
    accuracyM: 15,
  },
  odometry: { perM: 0.01, bearingDeg: 90, yawDegPerMin: 0.5 },
};

function scenarioLines(label: string, rows: readonly InstantRow[]): string[] {
  return rows.map(
    (r) =>
      `${label} | +${String(r.s)} s, path ${r.pathM.toFixed(0)} m, hold share ${r2(r.share)} | total ${r3(r.split.total.m)} m ${r2(r.split.total.deg)} deg | pull ${r3(r.split.pull.m)} m ${r2(r.split.pull.deg)} deg | drift ${r3(r.split.drift.m)} m ${r2(r.split.drift.deg)} deg`,
  );
}

type SyntheticGps = Extract<ScenarioParams["gps"], { kind: "synthetic" }>;
type Arm = [string, ScenarioParams, VotePathKnobs];

describe.runIf(MODE === "kitchen")(
  "QR hold replay: the kitchen, synthetic",
  () => {
    // Parameters every row rests on (declared; the base is KITCHEN): a code
    // scanned 15 s into the session (10 voted locks), then 7 minutes of a
    // slow wander in a 5 m x 4 m room at 0.25 m/s; 1 Hz fixes; today's
    // knobs unless the arm says otherwise; no compass readings (the
    // synthetic sessions carry none: the compass is swept on the real
    // recording only).
    const g = KITCHEN.gps as SyntheticGps;
    const still = { perM: 0, bearingDeg: 90, yawDegPerMin: 0 };
    const arms: Arm[] = [
      ["base", KITCHEN, TODAY_KNOBS],
      ["base, GPS ignored", KITCHEN, { ...TODAY_KNOBS, gps: "off" }],
      ["no odometry drift", { ...KITCHEN, odometry: still }, TODAY_KNOBS],
      [
        "no GPS error",
        { ...KITCHEN, gps: { ...g, biasM: 0, wanderM: 0, whiteM: 0 } },
        TODAY_KNOBS,
      ],
      ...[0, 3, 15, 25].map((b): Arm => [
        `GPS bias ${String(b)} m`,
        { ...KITCHEN, gps: { ...g, biasM: b } },
        TODAY_KNOBS,
      ]),
      ...[150, 240, 330].map((b): Arm => [
        `GPS bias bearing ${String(b)} deg`,
        { ...KITCHEN, gps: { ...g, biasBearingDeg: b } },
        TODAY_KNOBS,
      ]),
      ...[0, 10].map((w): Arm => [
        `GPS wander ${String(w)} m`,
        { ...KITCHEN, gps: { ...g, wanderM: w } },
        TODAY_KNOBS,
      ]),
      ...[5, 30].map((acc): Arm => [
        `reported accuracy ${String(acc)} m`,
        { ...KITCHEN, gps: { ...g, accuracyM: acc } },
        TODAY_KNOBS,
      ]),
      ...[0, 0.005, 0.02].map((d): Arm => [
        `odometry drift ${String(d * 100)} % of path`,
        { ...KITCHEN, odometry: { ...KITCHEN.odometry, perM: d } },
        TODAY_KNOBS,
      ]),
      ...[0, 1, 2].map((y): Arm => [
        `yaw drift ${String(y)} deg/min`,
        { ...KITCHEN, odometry: { ...KITCHEN.odometry, yawDegPerMin: y } },
        TODAY_KNOBS,
      ]),
      ...[0.1, 0.5].map((v): Arm => [
        `walking ${String(v)} m/s`,
        { ...KITCHEN, speedMps: v },
        TODAY_KNOBS,
      ]),
      ...[11, 23].map((seed): Arm => [
        `seed ${String(seed)}`,
        { ...KITCHEN, seed },
        TODAY_KNOBS,
      ]),
      ["hard trim", KITCHEN, { ...TODAY_KNOBS, softTrim: null }],
      ...[60_000, 240_000, 1e9].map((h): Arm => [
        h > 1e8 ? "hold forever" : `hold ${String(h / 1000)} s`,
        KITCHEN,
        { ...TODAY_KNOBS, holdMs: h },
      ]),
      [
        "hold forever, GPS ignored",
        KITCHEN,
        { ...TODAY_KNOBS, holdMs: 1e9, gps: "off" },
      ],
      ...[
        [0.5, 1],
        [1, 5],
        [2, 5],
      ].map(([exp, acc]): Arm => [
        `accuracy exponent ${String(exp)}, votes at ${String(acc)} m`,
        KITCHEN,
        { ...TODAY_KNOBS, accuracyExponent: exp!, syntheticAccuracyM: acc! },
      ]),
      ...(["reach", "excursion", "path"] as const).map((measure): Arm => [
        `distance hold ${measure} 10 m + fade 20 m`,
        KITCHEN,
        { ...TODAY_KNOBS, distanceHold: { measure, holdM: 10, fadeM: 20 } },
      ]),
    ];
    it.each(arms)(
      "%s",
      (label, params, knobs) => {
        const rows = runScenario(params, knobs);
        say(scenarioLines(label, rows));
        expect(rows.length).toBeGreaterThan(0);
      },
      900_000,
    );
  },
);

// ---------------------------------------------------------------------------
// The corpus's GPS error (§7 #8): the cross-day offsets of the D20 cache's
// reference points as the bias, a real walk's residuals as the wander.
// ---------------------------------------------------------------------------

/** Cross-day offsets: where walk B's alignment puts a reference point that
 *  walk A's alignment saved, north/east (m) - the error a code minted on one
 *  day meets on another. The D20 file's filters: collisions removed without
 *  GPS (COLLISION_RULE), a 60 m raw-GPS identity cutoff. */
function crossDayOffsets(walks: readonly Walk[]): {
  offsets: { key: string; n: number; e: number; m: number }[];
  points: number;
} {
  const collisions = nameCollisions(markSites(walks), COLLISION_RULE);
  const byKey = new Map<string, Obs[]>();
  for (const o of usableMarks(walks)) {
    byKey.set(o.m.key, [...(byKey.get(o.m.key) ?? []), o]);
  }
  const offsets: { key: string; n: number; e: number; m: number }[] = [];
  const fixAt = (fixes: readonly { t: number }[], t: number): number => {
    let k = -1;
    for (let i = 0; i < fixes.length && fixes[i]!.t <= t; i += 1) k = i;
    return k;
  };
  for (const [key, list] of byKey) {
    if (collisions.ambiguous.has(key)) continue;
    for (const A of list) {
      for (const B of list) {
        if (A.w.key === B.w.key) continue;
        const dA = dayOf(A.w.key);
        const dB = dayOf(B.w.key);
        if (dA === null || dB === null || dA === dB) continue;
        if (collisions.inconsistent.has(pairId(A.w.key, B.w.key, key))) {
          continue;
        }
        const fa = A.w.fixes![fixAt(A.w.fixes!, A.m.t)];
        const fb = B.w.fixes![fixAt(B.w.fixes!, B.m.t)];
        if (fa === undefined || fb === undefined) continue;
        const raw = nueToOtherZero([fa.g[0], 0, fa.g[1]], A.w.zero!, B.w.zero!);
        if (Math.hypot(raw[0] - fb.g[0], raw[2] - fb.g[1]) > 60) continue;
        const storedA = throughAlignment(
          { position: nueOdom(A.m.position), rotation: A.m.rotation },
          A.m.a!,
        );
        const seenB = throughAlignment(
          { position: nueOdom(B.m.position), rotation: B.m.rotation },
          B.m.a!,
        );
        if (storedA === null || seenB === null) continue;
        const stored = nueToOtherZero(storedA.position, A.w.zero!, B.w.zero!);
        const n = seenB.position[0] - stored[0];
        const e = seenB.position[2] - stored[2];
        offsets.push({ key, n, e, m: Math.hypot(n, e) });
      }
    }
  }
  return { offsets, points: new Set(offsets.map((o) => o.key)).size };
}

/** A walk's residuals around its own final alignment, per fix: the GPS
 *  wander with the walk's own bias removed. */
function residualSeries(w: Walk): [number, number, number][] {
  const fixes = w.fixes ?? [];
  const final = fixes.at(-1)?.a ?? null;
  if (final === null) return [];
  return fixes.map((f) => {
    const o = f.o;
    const n =
      final[0]! * o[0] + final[4]! * o[1] + final[8]! * o[2] + final[12]!;
    const e =
      final[2]! * o[0] + final[6]! * o[1] + final[10]! * o[2] + final[14]!;
    return [f.g[0] - n, f.g[1] - e, f.acc ?? 10];
  });
}

describe.runIf(MODE === "corpus")(
  "QR hold replay: the kitchen under the corpus's GPS error",
  () => {
    it("measures real odometry drift from the walks' repeated marks of one spot", () => {
      // Why: the synthetic kitchen's verdict rests on an ASSUMED drift rate;
      // the corpus has the real one. A reference point marked twice in one
      // walk is one physical spot, so the odometry distance between the two
      // marks is drift (plus the walker's marking error, ~0.1-0.3 m). Names
      // marked more than 10 m apart within a walk are excluded as collisions
      // (COLLISION_RULE.withinWalkM), which caps the measured drift at 10 m.
      const walks = loadWalks().filter(
        (w) => w.skipped === undefined && (w.fixes?.length ?? 0) > 0,
      );
      expect(walks.length, `the D20 cache at ${CACHE_DIR}`).toBeGreaterThan(0);
      const ambiguous = nameCollisions(
        markSites(walks),
        COLLISION_RULE,
      ).ambiguous;
      const rows: { place: string; pathM: number; s: number; m: number }[] = [];
      for (const w of walks) {
        const fixes = w.fixes ?? [];
        const marks = (w.marks ?? []).filter((m) => !ambiguous.has(m.key));
        const pathBetween = (t1: number, t2: number): number => {
          let total = 0;
          let prev: readonly number[] | null = null;
          for (const f of fixes) {
            if (f.t < t1 || f.t > t2) continue;
            if (prev !== null)
              total += Math.hypot(f.o[0] - prev[0]!, f.o[2] - prev[2]!);
            prev = f.o;
          }
          return total;
        };
        for (let i = 0; i < marks.length; i += 1) {
          for (let j = i + 1; j < marks.length; j += 1) {
            const a = marks[i]!;
            const b = marks[j]!;
            if (a.key !== b.key || b.t - a.t < 30_000) continue;
            const pa = nueOdom(a.position);
            const pb = nueOdom(b.position);
            rows.push({
              place: w.place,
              pathM: pathBetween(a.t, b.t),
              s: (b.t - a.t) / 1000,
              m: Math.hypot(pb[0] - pa[0], pb[2] - pa[2]),
            });
          }
        }
      }
      const lines: string[] = [
        `within-walk repeats (>= 30 s apart): ${String(rows.length)} pairs in ${String(new Set(rows.map((r) => r.place)).size)} places`,
      ];
      const bins: [string, (r: (typeof rows)[number]) => boolean][] = [
        ["path < 20 m", (r) => r.pathM < 20],
        ["path 20-50 m", (r) => r.pathM >= 20 && r.pathM < 50],
        ["path 50-100 m", (r) => r.pathM >= 50 && r.pathM < 100],
        ["path 100-300 m", (r) => r.pathM >= 100 && r.pathM < 300],
        ["path >= 300 m", (r) => r.pathM >= 300],
      ];
      for (const place of ["indoor", "outdoor", "mixed", "other", "all"]) {
        for (const [label, inBin] of bins) {
          const sel = rows.filter(
            (r) => (place === "all" || r.place === place) && inBin(r),
          );
          if (sel.length === 0) continue;
          const q = (vals: number[], p: number) => {
            const s = [...vals].sort((x, y) => x - y);
            return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
          };
          const m = sel.map((r) => r.m);
          const perPath = sel
            .filter((r) => r.pathM > 1)
            .map((r) => (100 * r.m) / r.pathM);
          const perMin = sel.map((r) => (60 * r.m) / r.s);
          lines.push(
            `drift ${place}, ${label}: n ${String(sel.length)}, metres p50 ${r2(q(m, 0.5))} p90 ${r2(q(m, 0.9))}; % of path p50 ${r2(q(perPath, 0.5))} p90 ${r2(q(perPath, 0.9))}; m per minute p50 ${r3(q(perMin, 0.5))} p90 ${r3(q(perMin, 0.9))}; gap p50 ${q(
              sel.map((r) => r.s),
              0.5,
            ).toFixed(0)} s`,
          );
        }
      }
      say(lines);
      expect(rows.length).toBeGreaterThan(0);
    }, 600_000);

    it("reproduces the D20 reference-point set, then runs the kitchen on it", () => {
      const walks = loadWalks().filter(
        (w) => w.skipped === undefined && (w.fixes?.length ?? 0) > 0,
      );
      expect(walks.length, `the D20 cache at ${CACHE_DIR}`).toBeGreaterThan(0);
      const { offsets, points } = crossDayOffsets(walks);
      const sorted = [...offsets].sort((a, b) => a.m - b.m);
      const q = (p: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
      say([
        `corpus: ${String(walks.length)} walks, ${String(offsets.length)} cross-day pairs of ${String(points)} reference points (D20: 6,166 of 42); offset p50 ${q(0.5).m.toFixed(1)} m, p90 ${q(0.9).m.toFixed(1)} m, p99 ${q(0.99).m.toFixed(1)} m`,
      ]);
      // Wander series: the two longest walks per place with an alignment.
      const series = (place: string) =>
        walks
          .filter((w) => w.place === place && (w.fixes?.length ?? 0) >= 300)
          .sort((a, b) => (b.fixes?.length ?? 0) - (a.fixes?.length ?? 0))
          .slice(0, 2)
          .map((w) => ({
            label: `${place} ${w.key}`,
            errors: residualSeries(w),
          }))
          .filter((s) => s.errors.length >= 300);
      const wanders = [...series("indoor"), ...series("outdoor")];
      for (const wander of wanders) {
        const lines: string[] = [
          `wander ${wander.label}: residual p50 ${r2(median(wander.errors.map(([n, e]) => Math.hypot(n, e))))} m, accuracy p50 ${r2(median(wander.errors.map((x) => x[2])))} m`,
        ];
        for (const [qn, pick] of [
          ["p50", q(0.5)],
          ["p90", q(0.9)],
          ["p99", q(0.99)],
        ] as const) {
          const errors = wander.errors.map(
            ([n, e, acc]): [number, number, number] => [
              n + pick.n,
              e + pick.e,
              acc,
            ],
          );
          for (const [armLabel, knobs] of [
            ["today", TODAY_KNOBS],
            ["GPS ignored", { ...TODAY_KNOBS, gps: "off" as const }],
          ] as const) {
            const rows = runScenario(
              {
                ...KITCHEN,
                gps: { kind: "series", errors, label: wander.label },
              },
              knobs,
            );
            lines.push(
              ...scenarioLines(
                `corpus ${wander.label}, bias ${qn} ${pick.m.toFixed(1)} m, ${armLabel}`,
                rows,
              ),
            );
          }
        }
        say(lines);
      }
    }, 3_600_000);
  },
);
