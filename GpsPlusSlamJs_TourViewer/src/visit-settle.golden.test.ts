/**
 * THE ONE-CODE ORACLE (code book refactor plan
 * GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md,
 * M1, second review #5, M1 review #3/#4/#8): the settle's outputs for many
 * seeded one-code scenarios, frozen BEFORE the settle is generalised to
 * several codes (M4). M4 must reproduce every one of them - through a
 * mechanical adapter from these inputs to its own - so the generalisation
 * cannot change a one-code tour. An oracle frozen first, not a test
 * written with the change (CLAUDE.md: tests written with the code confirm
 * its bugs).
 *
 * Numbers are compared to absolute steps (1e-7: a centimetre of latitude,
 * a tenth of a micrometre, a 1e-7 quaternion component), level files are
 * parsed and compared the same way, so a reordered float operation does
 * not fail it and a real change does.
 *
 * The outputs live in `__golden__/visit-settle.golden.json`. Regenerate
 * ONLY when a one-code result is meant to change, say why in the commit,
 * and never in CI: `GOLDEN_UPDATE=1 pnpm run test:unit src/visit-settle.golden.test.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import { mintQrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { mintPhoto, mintPin } from "./content-placement.js";
import { planCodePosition } from "./code-position-settle.js";
import { moveWithCode } from "./move-with-code.js";
import { throughAlignment, type NuePose } from "./visit-anchoring.js";
import {
  planMove,
  planVisitSettle,
  settleAlignment,
  sightedCodeOffset,
  storedGeo,
  type CodeMeasurement,
  type CodeSighting,
  type TimedAlignment,
  type VisitSettleInput,
} from "./visit-settle.js";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const GOLDEN = fileURLToPath(
  new URL("./__golden__/visit-settle.golden.json", import.meta.url),
);
const ZERO = { lat: 47.5, lon: 8.7 };
const NOW = "2026-10-06T12:00:00.000Z";
const LEVEL_ID = "a1b2c3d4e5f6";
const TEXT = "https://gps.csutil.com/tour/?qr=golden";
const SCENARIOS = 120;

/** A small seeded generator (mulberry32): the same scenarios every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function yawQ(deg: number): [number, number, number, number] {
  const h = (deg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
}

function alignment(deg: number, t: [number, number, number]): number[] {
  return new Matrix4()
    .compose(
      new Vector3(...t),
      new Quaternion(...yawQ(deg)),
      new Vector3(1, 1, 1),
    )
    .toArray();
}

const INFO = (accuracyM: number) => ({
  hasMatrix: true,
  sampleCount: 8,
  gpsAccuracyM: accuracyM,
});

function levelThrough(
  odomPose: Pose,
  through: number[],
  accuracyM: number,
  extentM?: number,
): { id: string; json: string } {
  const r = mintQrLevel({
    odomPose,
    alignmentMatrix: through as never,
    zero: ZERO,
    alignment: INFO(accuracyM),
    sizeM: 0.16,
    nowIso: NOW,
  });
  if (!r.ok) throw new Error(r.error);
  if (extentM === undefined) return { id: LEVEL_ID, json: r.json };
  const level = JSON.parse(r.json) as {
    qr: { mintQuality?: Record<string, unknown> };
  };
  level.qr.mintQuality = {
    ...level.qr.mintQuality,
    alignmentGpsExtentM: extentM,
  };
  return { id: LEVEL_ID, json: JSON.stringify(level) };
}

type Kind = "measured" | "measured-earlier" | "stored" | "stored-far" | "none";
type Answer = "moved" | "second-copy" | null;

interface Scenario {
  kind: Kind;
  answer: Answer;
  input: VisitSettleInput;
  move: { object: TourObject; local: NuePose };
}

/** One seeded one-code visit, in today's settle input shape. */
function scenario(seed: number): Scenario {
  const r = rng(seed + 1);
  const span = (a: number, b: number) => a + (b - a) * r();
  const kind = (
    ["measured", "measured-earlier", "stored", "stored-far", "none"] as const
  )[seed % 5]!;
  const answer = ([null, "moved", "second-copy"] as const)[
    Math.floor(seed / 5) % 3
  ]!;
  const visit = 2;
  const accuracyM = span(2, 10);
  const end = alignment(span(-30, 30), [span(-10, 10), 400, span(-10, 10)]);
  const code: Pose = {
    position: [span(-2, 2), 1.5, span(-4, -1)],
    rotation: yawQ(span(-20, 20)),
  };
  const storedThrough =
    kind === "stored-far"
      ? alignment(span(-40, 40), [span(30, 60), 400, span(-30, 30)])
      : alignment(span(-10, 10), [span(-4, 4), 400, span(-4, 4)]);
  // Every fourth stored level comes from a well-walked visit (U3's
  // "stored-good"); the rest record no spread (levels from before D31).
  const storedExtent = seed % 4 === 0 ? 80 : undefined;
  const level =
    kind === "none"
      ? null
      : kind === "measured" || kind === "measured-earlier"
        ? levelThrough(code, end, accuracyM)
        : levelThrough(code, storedThrough, accuracyM, storedExtent);
  const measurement: CodeMeasurement | null =
    kind === "measured" || kind === "measured-earlier"
      ? {
          levelId: LEVEL_ID,
          text: TEXT,
          odomPose: code,
          sizeM: 0.16,
          // An earlier visit's measurement is not "measured here".
          visit: kind === "measured" ? visit : 1,
        }
      : null;
  // Some sightings see another print 30 m away: a refusal inside a
  // measured visit (`measuredChoice`) as well as of a stored code.
  const secondPrint = seed % 7 === 3;
  const sightingPose: Pose = secondPrint
    ? { position: [30, 1.5, -2], rotation: yawQ(90) }
    : code;
  const sighting: CodeSighting | null =
    kind === "none"
      ? null
      : { text: TEXT, levelId: LEVEL_ID, odomPose: sightingPose };
  // Walked distance grows with time, as a walk does; every sixth visit
  // keeps no walked distance (the rules before R1 and R3 of D33).
  const keepsWalk = seed % 6 !== 5;
  let walked = 0;
  let clock = 0;
  const pick = (): TimedAlignment => {
    clock += 1_000 + Math.floor(r() * 4_000);
    walked += span(0, 25);
    return {
      atMs: clock,
      ...(keepsWalk ? { walkedM: walked } : {}),
      alignment: alignment(span(-30, 30), [span(-10, 10), 400, span(-10, 10)]),
      alignmentInfo: INFO(span(2, 10)),
      gpsExtentM: span(0, 80),
    };
  };
  const measurementPick = kind === "measured" ? pick() : null;
  const n = 1 + Math.floor(r() * 4);
  const placed = Array.from({ length: n }, (_, i) => {
    const local: [number, number, number] = [
      span(-30, 30),
      span(-1, 1),
      span(-30, 30),
    ];
    const id = `obj-${String(seed)}-${String(i)}`;
    // Photos too: their plane turns with the alignment, a pin's does not.
    const photo = (seed + i) % 3 === 0;
    const rotation = photo ? yawQ(span(-90, 90)) : yawQ(0);
    const object = (
      photo
        ? mintPhoto({
            id,
            cameraPose: { position: local, rotation },
            alignmentMatrix: end as never,
            zero: ZERO,
            imageWidth: 4,
            imageHeight: 3,
            nowIso: NOW,
          })
        : mintPin({
            id,
            label: `pin ${String(i)}`,
            worldNuePosition: (() => {
              const w = throughAlignment(
                { position: local, rotation: [0, 0, 0, 1] },
                end,
              )!;
              return { x: w.position[0], y: w.position[1], z: w.position[2] };
            })(),
            zero: ZERO,
            nowIso: NOW,
          })
    ) as TourObject;
    // Every fifth object was placed in an EARLIER visit: not this
    // visit's to settle.
    const placedIn = (seed + i) % 5 === 4 ? 1 : visit;
    const pose: NuePose = { position: local, rotation };
    return { object, placement: { visit: placedIn, local: pose } };
  });
  const objectPicks = new Map(placed.map((p) => [p.object.id, pick()]));
  const sightings =
    sighting === null
      ? []
      : Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({
          ...pick(),
          sighting,
        }));
  // A tie in walked distance between the measurement and a sighting (the
  // tie goes to the measurement).
  const first = sightings[0];
  if (
    seed % 9 === 0 &&
    measurementPick?.walkedM !== undefined &&
    first !== undefined
  ) {
    sightings[0] = { ...first, walkedM: measurementPick.walkedM };
  }
  const withPicks = seed % 4 !== 1;
  const input: VisitSettleInput = {
    visit,
    placed,
    alignment: end,
    zero: ZERO,
    mintedLevel: level,
    measurement,
    sighting,
    gpsAccuracyM: accuracyM,
    alignmentInfo: INFO(accuracyM),
    alignmentGpsExtentM: span(0, 80),
    nowIso: NOW,
    picks: withPicks
      ? { objects: objectPicks, measurement: measurementPick, sightings }
      : null,
  };
  return {
    kind,
    answer,
    input,
    move: {
      object: placed[0]!.object,
      local: {
        position: [span(-20, 20), 0, span(-20, 20)],
        rotation: [0, 0, 0, 1],
      },
    },
  };
}

const STEP = 1e-7;

/** Numbers to absolute steps of 1e-7; level files (JSON in strings)
 *  parsed and treated the same way; Maps as objects. */
function rounded(value: unknown): unknown {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value / STEP) * STEP + 0 : value;
  }
  if (typeof value === "string" && value.startsWith("{")) {
    try {
      return { json: rounded(JSON.parse(value) as unknown) };
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map(rounded);
  if (value instanceof Map) return rounded(Object.fromEntries(value));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, rounded(v)]),
    );
  }
  return value;
}

interface Output {
  kind: Kind;
  answer: Answer;
  planVisitSettle: {
    level: unknown;
    basis: string;
    objects: { basis: string; refused: unknown; object: { kind: string } }[];
  } | null;
  planCodePosition: { decision: { kind: string; reason?: string } } | null;
  composed: { level: unknown } | null;
  movedWithCode: unknown[] | null;
}

function outputs(seed: number): Output {
  const { kind, answer, input, move } = scenario(seed);
  const position = planCodePosition({
    visit: input.visit,
    mintedLevel: input.mintedLevel,
    measurement: input.measurement,
    sighting: input.sighting,
    picks: input.picks,
    alignment: input.alignment,
    zero: input.zero,
    endQuality: {
      extentM: input.alignmentGpsExtentM ?? null,
      accuracyM: input.gpsAccuracyM ?? null,
    },
    sizeM: 0.16,
    answerAt: () => answer,
  });
  // The settle as production composes it (`creator-setup.ts` settleVisit):
  // a changed code position is handed to the settle as a measurement.
  const remint = position?.measurement ?? null;
  const picks = input.picks;
  const composedInput: VisitSettleInput =
    remint === null
      ? input
      : {
          ...input,
          measurement: remint,
          picks:
            picks === null || picks === undefined
              ? picks
              : { ...picks, measurement: position?.pick ?? null },
        };
  const composed = planVisitSettle(composedInput);
  // An improved code takes the earlier objects with it.
  const oldGeo =
    input.mintedLevel === null ? null : storedGeo(input.mintedLevel.json);
  const newLevel = composed?.level ?? null;
  const newGeo = newLevel === null ? null : storedGeo(newLevel.json);
  const movedWithCode =
    position?.decision.kind === "replace" && oldGeo !== null && newGeo !== null
      ? input.placed.map((p) => moveWithCode(p.object.geo, oldGeo, newGeo))
      : null;
  return rounded({
    seed,
    kind,
    answer,
    settleAlignment: settleAlignment(input),
    planVisitSettle: planVisitSettle(input),
    planMove: planMove({ ...input, ...move }),
    sightedCodeOffset: sightedCodeOffset(input),
    planCodePosition: position,
    composed,
    movedWithCode,
  }) as Output;
}

describe("the one-code settle oracle (frozen before M4)", () => {
  const now = Array.from({ length: SCENARIOS }, (_, seed) => outputs(seed));

  it(`reproduces the frozen outputs of ${String(SCENARIOS)} seeded one-code visits`, () => {
    if (process.env["GOLDEN_UPDATE"] === "1") {
      // A regeneration absorbs whatever changed: never unattended.
      if (process.env["CI"]) {
        throw new Error("GOLDEN_UPDATE is refused in CI.");
      }
      writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
    }
    const frozen = JSON.parse(readFileSync(GOLDEN, "utf8")) as unknown[];
    expect(frozen).toHaveLength(SCENARIOS);
    for (let seed = 0; seed < SCENARIOS; seed += 1) {
      expect(now[seed], `seed ${String(seed)}`).toEqual(frozen[seed]);
    }
  });

  it("covers every path M4 rewrites (an oracle that skips one would pass a broken generalisation)", () => {
    const settled = now.flatMap((o) =>
      o.planVisitSettle === null ? [] : [o.planVisitSettle],
    );
    const objects = settled.flatMap((p) => p.objects);
    expect(new Set(settled.map((p) => p.basis))).toEqual(
      new Set(["measured-here", "code-corrected", "visit-alignment"]),
    );
    expect(settled.some((p) => p.level !== null)).toBe(true);
    // Refusals of a stored code, and inside a measured visit.
    expect(
      objects.some((o) => o.refused !== null && o.basis === "visit-alignment"),
    ).toBe(true);
    expect(
      objects.some((o) => o.refused !== null && o.basis === "measured-here"),
    ).toBe(true);
    expect(objects.some((o) => o.object.kind === "photo")).toBe(true);
    expect(objects.some((o) => o.object.kind === "pin")).toBe(true);
    const decisions = new Set(
      now.flatMap((o) =>
        o.planCodePosition === null
          ? []
          : [
              `${o.planCodePosition.decision.kind}:${o.planCodePosition.decision.reason ?? ""}`,
            ],
      ),
    );
    for (const d of [
      "replace:",
      "move:",
      "move-waits:",
      "keep:far",
      "keep:not-walked",
      "keep:stored-good",
    ]) {
      expect(decisions, d).toContain(d);
    }
    const stored = (o: Output) =>
      o.kind === "stored" || o.kind === "stored-far";
    // A "second copy" decides nothing.
    expect(
      now.some(
        (o) =>
          stored(o) &&
          o.answer === "second-copy" &&
          o.planCodePosition === null,
      ),
    ).toBe(true);
    // The composed settle re-mints a stored code; objects move with it.
    expect(
      now.some(
        (o) => stored(o) && o.composed !== null && o.composed.level !== null,
      ),
    ).toBe(true);
    expect(now.some((o) => o.movedWithCode !== null)).toBe(true);
  });
});
