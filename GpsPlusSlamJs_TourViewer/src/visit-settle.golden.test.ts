/**
 * THE ONE-CODE ORACLE (code book refactor plan
 * GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md,
 * M1, second review #5): the settle's outputs for many seeded one-code
 * scenarios, frozen BEFORE the settle is generalised to several codes
 * (M4). M4 must reproduce every one of them exactly - through a mechanical
 * adapter from these inputs to its own - so the generalisation cannot
 * change a one-code tour. An oracle frozen first, not a test written with
 * the change (CLAUDE.md: tests written with the code confirm its bugs).
 *
 * The outputs live in `__golden__/visit-settle.golden.json`. Regenerate
 * ONLY when a one-code result is meant to change, and say why in the
 * commit: `GOLDEN_UPDATE=1 pnpm run test:unit src/visit-settle.golden.test.ts`.
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

import { mintPin } from "./content-placement.js";
import { planCodePosition } from "./code-position-settle.js";
import { throughAlignment, type NuePose } from "./visit-anchoring.js";
import {
  planMove,
  planVisitSettle,
  settleAlignment,
  sightedCodeOffset,
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
const SCENARIOS = 60;

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
  return { id: LEVEL_ID, json: r.json };
}

type Kind = "measured" | "stored" | "stored-far" | "none";

/** One seeded one-code visit, in today's settle input shape. */
function scenario(seed: number): {
  kind: Kind;
  input: VisitSettleInput;
  move: { object: TourObject; local: NuePose };
} {
  const r = rng(seed + 1);
  const span = (a: number, b: number) => a + (b - a) * r();
  const kind = (["measured", "stored", "stored-far", "none"] as const)[
    seed % 4
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
  const level =
    kind === "none"
      ? null
      : kind === "measured"
        ? levelThrough(code, end, accuracyM)
        : levelThrough(code, storedThrough, accuracyM);
  const measurement: CodeMeasurement | null =
    kind === "measured"
      ? { levelId: LEVEL_ID, text: TEXT, odomPose: code, sizeM: 0.16, visit }
      : null;
  const sighting: CodeSighting | null =
    kind === "none" ? null : { text: TEXT, levelId: LEVEL_ID, odomPose: code };
  const pick = (atMs: number, walkedM: number): TimedAlignment => ({
    atMs,
    walkedM,
    alignment: alignment(span(-30, 30), [span(-10, 10), 400, span(-10, 10)]),
    alignmentInfo: INFO(span(2, 10)),
    gpsExtentM: span(0, 80),
  });
  const n = 1 + Math.floor(r() * 4);
  const placed = Array.from({ length: n }, (_, i) => {
    const local: [number, number, number] = [
      span(-30, 30),
      span(-1, 1),
      span(-30, 30),
    ];
    const world = throughAlignment(
      { position: local, rotation: [0, 0, 0, 1] },
      end,
    )!;
    const object = mintPin({
      id: `pin-${String(seed)}-${String(i)}`,
      label: `pin ${String(i)}`,
      worldNuePosition: {
        x: world.position[0],
        y: world.position[1],
        z: world.position[2],
      },
      zero: ZERO,
      nowIso: NOW,
    }) as TourObject;
    return {
      object,
      placement: {
        visit,
        local: { position: local, rotation: [0, 0, 0, 1] as const },
      },
    };
  });
  const withPicks = seed % 3 !== 0;
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
      ? {
          objects: new Map(
            placed.map((p, i) => [
              p.object.id,
              pick(1_000 * (i + 2), span(0, 90)),
            ]),
          ),
          measurement: kind === "measured" ? pick(500, span(0, 20)) : null,
          sightings:
            sighting === null
              ? []
              : Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => ({
                  ...pick(800 + 1_000 * i, span(0, 90)),
                  sighting,
                })),
        }
      : null,
  };
  return {
    kind,
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

/** Numbers to 9 significant digits: the oracle must not fail on the last
 *  bit of a float, and must fail on any real change. */
function rounded(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) =>
      typeof v === "number" && Number.isFinite(v)
        ? Number(v.toPrecision(9))
        : v instanceof Map
          ? Object.fromEntries(v as Map<string, unknown>)
          : v,
    ),
  ) as unknown;
}

function outputs(seed: number): unknown {
  const { kind, input, move } = scenario(seed);
  return rounded({
    seed,
    kind,
    settleAlignment: settleAlignment(input),
    planVisitSettle: planVisitSettle(input),
    planMove: planMove({ ...input, ...move }),
    sightedCodeOffset: sightedCodeOffset(input),
    planCodePosition: planCodePosition({
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
      answerAt: () => null,
    }),
  });
}

describe("the one-code settle oracle (frozen before M4)", () => {
  it(`reproduces the frozen outputs of ${String(SCENARIOS)} seeded one-code visits`, () => {
    const now = Array.from({ length: SCENARIOS }, (_, seed) => outputs(seed));
    if (process.env["GOLDEN_UPDATE"] === "1") {
      writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
    }
    const frozen = JSON.parse(readFileSync(GOLDEN, "utf8")) as unknown[];
    expect(frozen).toHaveLength(SCENARIOS);
    for (let seed = 0; seed < SCENARIOS; seed += 1) {
      expect(now[seed], `seed ${String(seed)}`).toEqual(frozen[seed]);
    }
  });

  it("covers every kind of visit and both outcomes of the correction bound", () => {
    // Why: an oracle that never exercises a refusal or a re-mint would
    // pass a generalisation that breaks them.
    const all = Array.from({ length: SCENARIOS }, (_, s) => outputs(s)) as {
      kind: Kind;
      planVisitSettle: {
        level: unknown;
        refused: unknown;
        basis: string;
      } | null;
    }[];
    const settled = all.flatMap((o) =>
      o.planVisitSettle === null ? [] : [o.planVisitSettle],
    );
    expect(settled.some((p) => p.level !== null)).toBe(true);
    expect(settled.some((p) => p.refused !== null)).toBe(true);
    expect(new Set(settled.map((p) => p.basis))).toEqual(
      new Set(["measured-here", "code-corrected", "visit-alignment"]),
    );
  });
});
