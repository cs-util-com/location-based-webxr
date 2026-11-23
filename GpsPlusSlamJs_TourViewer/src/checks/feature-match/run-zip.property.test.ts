import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { DeviceInfo } from "./bench-report";
import { runZipFiles } from "./run-zip";
import { EMPTY_PLAN, planPhotos, planReducer, planShots } from "./run-plan";
import { derivedPairs, readyPairs } from "./scenes";

const SHOTS = planShots(EMPTY_PLAN).map((s) => s.id);

describe("run zip properties", () => {
  // Why: the PC finds every frame through the pair JSON's file names; a
  // name with no file, a shot shipped twice or a ready pair without a
  // folder would each lose a measurement.
  it("names only files it holds, each shot once, a folder per ready pair", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.nat({ max: SHOTS.length - 1 }), { maxLength: 30 }),
        async (taken) => {
          let n = 0;
          const plan = taken.reduce(
            (p, i) =>
              planReducer(p, {
                type: "photo",
                shot: SHOTS[i]!,
                photo: {
                  id: `p${String(++n)}`,
                  width: 640,
                  height: 480,
                  source: { width: 1280, height: 960 },
                  greyMean: 50 + (n % 7) * 20,
                },
              }),
            EMPTY_PLAN,
          );
          const files = await runZipFiles({
            plan,
            session: "s1",
            results: {},
            device: {} as DeviceInfo,
            captureMaxLongEdge: 1280,
            summary: "",
            log: "",
            photo: (id) => Promise.resolve(new Blob([id])),
            matches: () => Promise.resolve(undefined),
          });
          const paths = files.map((f) => f.path);
          const named = files
            .filter((f) => f.path.endsWith("frames.json"))
            .flatMap(
              (f) =>
                (JSON.parse(f.data as string) as { frames: { file: string }[] })
                  .frames,
            )
            .map((f) => f.file);
          const shots = paths.filter((p) => p.startsWith("shots/"));
          const ready = readyPairs(
            derivedPairs(plan.spots, plan.extra),
            planPhotos(plan),
          );
          expect({
            missing: named.filter((x) => !paths.includes(x)),
            unique: new Set(paths).size === paths.length,
            shots: shots.length,
            pairs: paths.filter((p) => p.endsWith("frames.json")).length,
          }).toEqual({
            missing: [],
            unique: true,
            shots: Object.keys(plan.shots).length,
            pairs: ready.length,
          });
        },
      ),
      { numRuns: 80 },
    );
  });
});
