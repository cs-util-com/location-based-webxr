import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { makeFrame } from "./bench-image";
import type { BenchMethod } from "./bench-run";
import type { MeasureAnswer } from "./measure-protocol";
import { handleMeasure, type MeasureEnv } from "./measure-worker-core";

const frame = makeFrame(4, 2, new Uint8ClampedArray(4 * 2 * 4).fill(255));

const request = (job: number) => ({
  type: "measure",
  job,
  a: new Blob(["A"]),
  b: new Blob(["B"]),
  turn: null,
  methods: { sift: true, aliked: false, siftLightGlue: false },
  sizes: [4],
  pair: "2a",
});

// Why this test matters: the worker keeps each loaded method (its ONNX
// sessions) for the next pair. Over any run of good and failing pairs it
// must load a method once plus once after each failed pair, dispose
// exactly the runners it dropped, and never dispose a kept one.
describe("handleMeasure keeps loaded methods, properties", () => {
  it("loads once plus once per failed pair, disposing only the dropped", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
        async (fails) => {
          const count = { init: 0, dispose: 0 };
          let failing = false;
          const method: BenchMethod = {
            id: "m",
            label: "M",
            init: () => {
              count.init += 1;
              return Promise.resolve({
                backend: "wasm",
                downloads: [],
                initMs: 100,
                notes: [],
                extract: () =>
                  failing
                    ? Promise.reject(new Error("lost"))
                    : Promise.resolve({
                        count: 1,
                        descriptorBytes: 1,
                        x: Float32Array.of(0),
                        y: Float32Array.of(0),
                        payload: null,
                      }),
                match: () => Promise.resolve(Int32Array.of(0, 0)),
                dispose: () => {
                  count.dispose += 1;
                },
              });
            },
          };
          let t = 0;
          const env: MeasureEnv = {
            decode: () => Promise.resolve(frame),
            webgpu: () => Promise.resolve(false),
            build: () => [method],
            now: () => (t += 1),
            kept: new Map(),
          };
          for (const [i, f] of fails.entries()) {
            failing = f;
            const posted: MeasureAnswer[] = [];
            await handleMeasure(request(i + 1), env, (a) => posted.push(a));
            await Promise.resolve();
          }
          const failed = fails.filter(Boolean).length;
          const failedBeforeLast = fails.slice(0, -1).filter(Boolean).length;
          expect(count.init).toBe(1 + failedBeforeLast);
          expect(count.dispose).toBe(failed);
          expect(env.kept.size).toBe(fails.at(-1) ? 0 : 1);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// Why this test matters: over any run of pairs with any model methods
// ticked, at most one model method stays loaded between pairs, SIFT is
// never reloaded, and every model load but the kept one is disposed.
describe("handleMeasure keeps one model method at a time, properties", () => {
  it("never keeps two model methods and disposes every other load", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.subarray(["x", "y", "z"]), { minLength: 1, maxLength: 6 }),
        async (picks) => {
          const count = new Map<string, { init: number; dispose: number }>();
          const method = (id: string, model: boolean): BenchMethod => ({
            id,
            label: id,
            ...(model ? { backend: "webgpu" as const } : {}),
            init: () => {
              const c = count.get(id) ?? { init: 0, dispose: 0 };
              count.set(id, c);
              c.init += 1;
              return Promise.resolve({
                backend: model ? "webgpu" : "js",
                downloads: [],
                initMs: 1,
                notes: [],
                extract: () =>
                  Promise.resolve({
                    count: 1,
                    descriptorBytes: 1,
                    x: Float32Array.of(0),
                    y: Float32Array.of(0),
                    payload: null,
                  }),
                match: () => Promise.resolve(Int32Array.of(0, 0)),
                dispose: () => {
                  c.dispose += 1;
                },
              });
            },
          });
          let pick: string[] = [];
          let t = 0;
          const env: MeasureEnv = {
            decode: () => Promise.resolve(frame),
            webgpu: () => Promise.resolve(false),
            build: () => [
              method("sift", false),
              ...pick.map((id) => method(id, true)),
            ],
            now: () => (t += 1),
            kept: new Map(),
          };
          for (const [i, p] of picks.entries()) {
            pick = p;
            await handleMeasure(request(i + 1), env, () => undefined);
            await Promise.resolve();
            const models = [...env.kept.keys()].filter((k) => k !== "sift");
            expect(models.length).toBeLessThanOrEqual(1);
          }
          expect(count.get("sift")).toEqual({ init: 1, dispose: 0 });
          for (const [id, c] of count) {
            const kept = env.kept.has(id) ? 1 : 0;
            expect(c.dispose).toBe(c.init - kept);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
