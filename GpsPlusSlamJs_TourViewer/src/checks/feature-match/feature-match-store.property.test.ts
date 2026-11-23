import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Frame } from "./bench-image";
import { featureMatchActions as A } from "./feature-match-slice";
import {
  createFeatureMatchStore,
  photoKey,
  type FeatureMatchStore,
  type KeyValueStorage,
} from "./feature-match-store";
import { planPhotoIds } from "./run-plan";
import type { KeyValueStore } from "../../key-value-db";

const SHOTS = [
  "light-s1/L1",
  "light-s1/L2",
  "light-s1/L3",
  "light-s1/L4",
  "flat-s1/F1",
] as const;

type Step =
  | { readonly kind: "photo"; readonly shot: number; readonly ok: boolean }
  | { readonly kind: "reset" };

const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 9,
    arbitrary: fc.record({
      kind: fc.constant("photo" as const),
      shot: fc.nat({ max: SHOTS.length - 1 }),
      ok: fc.boolean(),
    }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: "reset" as const }) },
);

const settle = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setImmediate(r));
  }
};

const memory = (): KeyValueStorage => {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
};

/** One PNG per id and one preview per PNG, so a test can compare them. */
const pngs = new Map<string, Blob>();
const png = (id: string): Blob => {
  const b = pngs.get(id) ?? new Blob([id], { type: "image/png" });
  pngs.set(id, b);
  return b;
};
const previews = new Map<Blob, Frame>();
const previewOf = (b: Blob): Promise<Frame> => {
  const f = previews.get(b) ?? {
    width: 1,
    height: 1,
    rgba: Uint8ClampedArray.of(previews.size % 256, 0, 0, 255),
  };
  previews.set(b, f);
  return Promise.resolve(f);
};

/** A Map database whose writes fail while `refuse` is set. */
const flakyDb = () => {
  const data = new Map<string, unknown>();
  const state = { refuse: false };
  const db: KeyValueStore = {
    get: (k) => Promise.resolve(data.get(k)),
    put: (k, v) => {
      if (state.refuse) {
        return Promise.reject(new Error("quota"));
      }
      data.set(k, v);
      return Promise.resolve();
    },
    delete: (k) => {
      data.delete(k);
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...data.keys()]),
  };
  return { data, db, state };
};

const open = (
  storage: KeyValueStorage,
  db: KeyValueStore,
  session: string,
): FeatureMatchStore =>
  createFeatureMatchStore({
    storage,
    session,
    revokeUrl: () => undefined,
    photoDb: db,
    photoDbFailed: () => undefined,
    previewOf,
  });

describe("photo storage properties", () => {
  // Why: whatever the order of photos, retakes, resets and refused writes,
  // a photo the page shows is never lost while the page lives (stored, or
  // still held in memory), storage holds exactly the stored photos, and a
  // reload brings back exactly those: each with its own preview, the rest
  // marked lost.
  it("never loses a shown photo, and a reload restores exactly the stored ones", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { maxLength: 14 }), async (steps) => {
        const storage = memory();
        const { data, db, state } = flakyDb();
        const fm = open(storage, db, "a");
        for (const s of steps) {
          if (s.kind === "reset") {
            fm.store.dispatch(A.planReset());
          } else {
            state.refuse = !s.ok;
            const id = fm.newId("photo");
            fm.sides.previews.set(id, {
              width: 1,
              height: 1,
              rgba: new Uint8ClampedArray(4),
            });
            fm.put(
              fm.sides.photos,
              [[id, Promise.resolve(png(id))]],
              A.planShotTaken({
                shot: SHOTS[s.shot]!,
                photo: {
                  id,
                  width: 4,
                  height: 3,
                  source: { width: 8, height: 6 },
                  greyMean: 100,
                },
              }),
            );
          }
          await settle(1);
        }
        await settle(3);
        const first = fm.store.getState();
        const named = planPhotoIds(first.plan).sort();
        const stored = [...first.storedIds].sort();
        const inDb = [...data.keys()]
          .filter((k) => k.startsWith("photo:"))
          .map((k) => k.slice("photo:".length))
          .sort();
        const held = named.filter((id) => fm.sides.photos.has(id));
        const kept = [...new Set([...stored, ...held])].sort();

        state.refuse = false;
        const next = open(storage, db, "b");
        await next.restore();
        const after = next.store.getState();
        const restored = planPhotoIds(after.plan).sort();
        const previewOk = await Promise.all(
          restored.map(
            async (id) =>
              next.sides.previews.get(id) === (await previewOf(png(id))),
          ),
        );
        fm.dispose();
        next.dispose();
        expect({
          inDb,
          kept,
          restored,
          stored: [...after.storedIds].sort(),
          previewOk,
        }).toEqual({
          inDb: stored,
          kept: named,
          restored: stored,
          stored,
          previewOk: restored.map(() => true),
        });
        expect(stored.every((id) => data.get(photoKey(id)) === png(id))).toBe(
          true,
        );
      }),
      { numRuns: 60 },
    );
  });
});
