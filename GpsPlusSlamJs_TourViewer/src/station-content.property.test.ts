import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";

import { createStationContent, type ContentPart } from "./station-content.js";

/**
 * Why this property matters: the side table's promises are
 * about every sequence of presence changes, part changes, frames and late
 * renders, not the handful the example tests walk. Over generated
 * sequences it holds that:
 * - while the page shows one station at most (presence, never "show all"),
 *   at most one station's group stands in the scene besides the
 *   always-shown content;
 * - every render's result is disposed at most once, and exactly once after
 *   the table is disposed;
 * - once a fade has ended, every material is back at its own opacity and
 *   its own transparent flag.
 */

const FADE = 400;

/** Let pending renders land: they settle through microtasks only. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}
const STATIONS = ["a", "b", "c"] as const;
const LOOSE = "loose";

type Op =
  | { kind: "show"; id: (typeof STATIONS)[number] | null }
  | { kind: "show-all" }
  | {
      kind: "part";
      id: (typeof STATIONS)[number] | typeof LOOSE;
      key: "x" | "y";
      remove: boolean;
      ownOpacity: number;
      delay: number;
    }
  | { kind: "frame"; ms: number }
  | { kind: "settle" };

const op = (allowShowAll: boolean): fc.Arbitrary<Op> =>
  fc.oneof(
    fc.record({
      kind: fc.constant("show" as const),
      id: fc.constantFrom(...STATIONS, null),
    }),
    ...(allowShowAll ? [fc.constant({ kind: "show-all" as const })] : []),
    fc.record({
      kind: fc.constant("part" as const),
      id: fc.constantFrom(...STATIONS, LOOSE),
      key: fc.constantFrom("x" as const, "y" as const),
      remove: fc.boolean(),
      ownOpacity: fc.constantFrom(1, 0.7),
      delay: fc.integer({ min: 0, max: 3 }),
    }),
    fc.record({
      kind: fc.constant("frame" as const),
      ms: fc.integer({ min: 0, max: 300 }),
    }),
    fc.constant({ kind: "settle" as const }),
  );

interface Made {
  readonly material: MeshBasicMaterial;
  readonly ownOpacity: number;
  disposals: number;
}

function partOf(made: Made[], ownOpacity: number, delay: number): ContentPart {
  return {
    kind: "content",
    async render(parent) {
      for (let i = 0; i < delay; i += 1) await Promise.resolve();
      const material = new MeshBasicMaterial({
        opacity: ownOpacity,
        transparent: ownOpacity < 1,
      });
      const mesh = new Mesh(new PlaneGeometry(1, 1), material);
      parent.add(mesh);
      const record: Made = { material, ownOpacity, disposals: 0 };
      made.push(record);
      return {
        count: 1,
        skipped: [],
        dispose: () => {
          record.disposals += 1;
          parent.remove(mesh);
        },
      };
    },
  };
}

async function run(ops: readonly Op[], presenceOnly: boolean): Promise<void> {
  const scene = new Group();
  const clock = { ms: 1000 };
  const made: Made[] = [];
  const content = createStationContent({
    scene,
    now: () => clock.ms,
    fadeMs: FADE,
    alwaysShown: (id) => id === LOOSE,
  });
  const stationGroups = () =>
    scene.children.filter((g) => g.name !== `station-content:${LOOSE}`).length;
  // Every station starts with a part, so presence changes always move
  // groups (a sequence that never sets one would test nothing).
  for (const id of [...STATIONS, LOOSE]) {
    content.setPart(id, "x", partOf(made, 1, 1));
  }
  for (const step of ops) {
    if (step.kind === "show") {
      content.show(new Set(step.id === null ? [] : [step.id]));
    } else if (step.kind === "show-all") {
      content.show(new Set(STATIONS));
    } else if (step.kind === "part") {
      content.setPart(
        step.id,
        step.key,
        step.remove ? null : partOf(made, step.ownOpacity, step.delay),
      );
    } else if (step.kind === "frame") {
      clock.ms += step.ms;
      content.update(clock.ms);
    } else {
      await flush();
    }
    if (presenceOnly) expect(stationGroups()).toBeLessThanOrEqual(1);
    for (const m of made) expect(m.disposals).toBeLessThanOrEqual(1);
  }
  // Let every render land and every fade end, then check the materials.
  await flush();
  for (let i = 0; i < 4; i += 1) {
    clock.ms += FADE;
    content.update(clock.ms);
    await flush();
  }
  if (presenceOnly) expect(stationGroups()).toBeLessThanOrEqual(1);
  for (const m of made) {
    if (m.disposals > 0) continue;
    expect(m.material.opacity).toBe(m.ownOpacity);
    expect(m.material.transparent).toBe(m.ownOpacity < 1);
  }
  content.dispose();
  await flush();
  for (const m of made) expect(m.disposals).toBe(1);
}

describe("station content: properties over generated sequences", () => {
  it("presence only: one station group at a time besides the always-shown content; every result disposed once; materials restored", async () => {
    let runs = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.array(op(false), { minLength: 10, maxLength: 40, size: "max" }),
        (ops) => {
          runs += 1;
          return run(ops, true);
        },
      ),
      { numRuns: 150 },
    );
    // Every generated sequence ran its checks (`run` asserts).
    expect(runs).toBe(150);
  });

  it("with show all mixed in: every result disposed once; materials restored", async () => {
    let runs = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.array(op(true), { minLength: 10, maxLength: 40, size: "max" }),
        (ops) => {
          runs += 1;
          return run(ops, false);
        },
      ),
      { numRuns: 150 },
    );
    expect(runs).toBe(150);
  });
});
