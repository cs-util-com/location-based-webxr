/**
 * The speed test's arm list from the page's choices: per backend the XFeat
 * reference, SIFT + LightGlue and the DINOv2 variants, all on one pair
 * resized once to the chosen long edge.
 *
 * @see speed-test.ts.md
 */
import { resizeFrame, sizeForLongEdge } from "./bench-image";
import type { LoadDeps } from "./bench-net";
import type { BenchInput } from "./bench-run";
import { methodTimingArm, type TimingArm } from "./bench-timing";
import { dinoTimingArm, type DinoVariant } from "./method-dino";
import { siftLightGlueMethod } from "./method-sift-lightglue";
import { xfeatMethod } from "./method-xfeat";

export interface SpeedTestChoice {
  readonly xfeat: boolean;
  readonly siftLightGlue: boolean;
  readonly dino: readonly DinoVariant[];
  readonly backends: readonly ("webgpu" | "wasm")[];
  /** Long edge of the pair the keypoint arms see, in pixels. */
  readonly longEdge: number;
  /** SIFT keypoints per frame for SIFT + LightGlue. */
  readonly siftCap: number;
}

/** The long edges and SIFT caps the page offers. */
export const SPEED_LONG_EDGES = [480, 640, 960] as const;
export const SPEED_SIFT_CAPS = [512, 1024] as const;

/** The pair resized once, keeping the known warp of a synthetic pair. */
export function speedTestInput(
  input: BenchInput,
  longEdge: number,
): BenchInput {
  const { width, height } = sizeForLongEdge(
    input.a.width,
    input.a.height,
    longEdge,
  );
  return {
    a: resizeFrame(input.a, width, height),
    b: resizeFrame(input.b, width, height),
    warp: input.warp,
  };
}

/**
 * The arms in load order, per backend: the XFeat reference (fp16, the
 * smallest download) first, then DINOv2, then SIFT + LightGlue (the
 * largest). The harness balances the run order over the rounds anyway.
 */
export function speedTestArms(
  c: SpeedTestChoice,
  input: BenchInput,
  deps: LoadDeps,
): TimingArm[] {
  const sized = speedTestInput(input, c.longEdge);
  const arms: TimingArm[] = [];
  for (const b of c.backends) {
    if (c.xfeat) {
      arms.push(
        methodTimingArm(
          xfeatMethod(b, "fp16", deps),
          sized,
          { group: b, reference: true },
          deps.now,
        ),
      );
    }
    for (const v of c.dino) {
      arms.push(dinoTimingArm(v, b, deps, sized));
    }
    if (c.siftLightGlue) {
      arms.push(
        methodTimingArm(
          siftLightGlueMethod(b, deps, { maxFeatures: c.siftCap }),
          sized,
          { group: b, reference: false },
          deps.now,
        ),
      );
    }
  }
  return arms;
}

/** What every number rests on, for the report's settings line. */
export function speedTestSettings(
  c: SpeedTestChoice,
  input: BenchInput,
  backendNote: string | null,
  wasmThreads: number,
): string {
  const sized = sizeForLongEdge(input.a.width, input.a.height, c.longEdge);
  return [
    `long edge ${String(c.longEdge)} (${String(sized.width)}x${String(sized.height)}) for the keypoint arms`,
    `DINOv2 input 224x224`,
    `SIFT cap ${String(c.siftCap)} per frame`,
    `XFeat fp16 as the reference`,
    `backends ${c.backends.join("+") || "none"}${backendNote ? ` (${backendNote})` : ""}`,
    `ort wasm threads ${String(wasmThreads)}`,
  ].join(", ");
}
