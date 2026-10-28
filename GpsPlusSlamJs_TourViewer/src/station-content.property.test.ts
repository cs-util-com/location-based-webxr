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
 *   at most one station's group stands in the scene;
 * - every render's result is disposed at most once, and exactly once after
 *   the table is disposed;
 * - once a fade has ended, every material is back at its own opacity and
 *   its own transparent flag;
 * - once every render has landed and every fade ended, each station the
 *   page shows last that still has a part stands in the scene: a table that
 *   hides content holds the first three promises trivially, so this one
 *   makes them mean something.
 */

const FADE = 400;

/** Let SOME pending renders land (a "settle" step: a fixed number of
 *  microtasks, so a sequence can stop with renders still in flight). */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

/** Let EVERY pending render land: renders settle through microtasks only,
 *  and a macrotask runs once the microtask queue is empty. A fixed count
 *  of microtasks is not enough here: renders run one at a time, and a
 *  long sequence queues dozens of stale ones ahead of the last live one.
 *  `setImmediate`, not `setTimeout(0)`: a timer waits for the clock's
 *  tick (about 15 ms on Windows), which 150 runs cannot afford. */
async function drain(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
const STATIONS = ["a", "b", "c"] as const;

type Op =
  | { kind: "show"; id: (typeof STATIONS)[number] | null }
  | { kind: "show-all" }
  | {
      kind: "part";
      id: (typeof STATIONS)[number];
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
      id: fc.constantFrom(...STATIONS),
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
  });
  const stationGroups = () => scene.children.length;
  // Every station starts with a part, so presence changes always move
  // groups (a sequence that never sets one would test nothing).
  for (const id of STATIONS) {
    content.setPart(id, "x", partOf(made, 1, 1));
  }
  /** The model: the part keys each station holds, and what the page shows. */
  const keys = new Map<string, Set<string>>(
    STATIONS.map((id) => [id, new Set(["x"])]),
  );
  let shown = new Set<string>();
  for (const step of ops) {
    if (step.kind === "show") {
      shown = new Set(step.id === null ? [] : [step.id]);
      content.show(new Set(shown));
    } else if (step.kind === "show-all") {
      shown = new Set(STATIONS);
      content.show(new Set(shown));
    } else if (step.kind === "part") {
      if (step.remove) keys.get(step.id)!.delete(step.key);
      else keys.get(step.id)!.add(step.key);
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
  await drain();
  for (let i = 0; i < 4; i += 1) {
    clock.ms += FADE;
    content.update(clock.ms);
    await drain();
  }
  if (presenceOnly) expect(stationGroups()).toBeLessThanOrEqual(1);
  const standing = new Set(scene.children.map((g) => g.name));
  for (const id of shown) {
    if (keys.get(id)!.size === 0) continue;
    expect(standing.has(`station-content:${id}`)).toBe(true);
  }
  for (const m of made) {
    if (m.disposals > 0) continue;
    expect(m.material.opacity).toBe(m.ownOpacity);
    expect(m.material.transparent).toBe(m.ownOpacity < 1);
  }
  content.dispose();
  await drain();
  for (const m of made) expect(m.disposals).toBe(1);
}

describe("station content: properties over generated sequences", () => {
  it("presence only: one station group at a time; the shown station stands; every result disposed once; materials restored", async () => {
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

  it("a counterexample found by the property below: every shown station stands", async () => {
    // Why this test matters: fast-check seed 1782054768 found this
    // sequence; pinned so it runs whatever the seed. Its last live render
    // queues behind many stale ones, and lands only after the fixed
    // microtask budget of `flush`: the end of `run` must drain the queue,
    // or a station still fading in reads as materials not restored.
    // (`run` asserts; it resolves only when every check held.)
    await expect(
      run(
        [
          {
            kind: "part",
            id: "c",
            key: "y",
            remove: false,
            ownOpacity: 1,
            delay: 0,
          },
          { kind: "show-all" },
          {
            kind: "part",
            id: "a",
            key: "x",
            remove: false,
            ownOpacity: 1,
            delay: 0,
          },
          { kind: "show", id: null },
          { kind: "show-all" },
          { kind: "show", id: "a" },
          { kind: "show-all" },
          { kind: "show", id: "a" },
          { kind: "show", id: "b" },
          { kind: "show", id: "a" },
          { kind: "show", id: "c" },
          { kind: "frame", ms: 0 },
          { kind: "show", id: "a" },
          { kind: "show-all" },
          { kind: "show", id: "a" },
          { kind: "frame", ms: 0 },
          { kind: "show", id: "c" },
          { kind: "show", id: "a" },
          { kind: "show", id: "c" },
        ],
        false,
      ),
    ).resolves.toBeUndefined();
  });

  it("with show all mixed in: every shown station stands; every result disposed once; materials restored", async () => {
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
