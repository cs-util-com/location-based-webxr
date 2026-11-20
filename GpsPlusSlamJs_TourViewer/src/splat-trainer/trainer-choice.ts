/**
 * Which trainer the splat trainer page runs, from its address. The page
 * runs the real trainer on the graphics card, unless the address says
 * exactly `?trainer=practice`: then it runs the scripted practice
 * trainer, which the page shows as a practice run; with the
 * practice trainer, `gpu=integrated` or `gpu=no-webgpu` makes its probe
 * report that, and `pace=<n>` runs it n times faster. Unknown values fall
 * back to the defaults, never to NaN.
 *
 * @see trainer-choice.ts.md
 */

import { parsePace } from "./fake-trainer.js";
import type { GpuProbe } from "./trainer-adapter.js";

export interface TrainerChoice {
  /** Which trainer runs: `practice` only for `?trainer=practice`. */
  readonly trainer: "practice" | "gpu";
  readonly gpu: GpuProbe["kind"];
  readonly pace: number;
  /** The stretch (1-based) whose first try loses the graphics card in
   *  the practice run (`lost=<n>`), or null. */
  readonly lost: number | null;
}

function positiveIntegerOrNull(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function trainerChoiceFrom(search: string): TrainerChoice {
  const q = new URLSearchParams(search);
  const gpu = q.get("gpu");
  return {
    trainer: q.get("trainer") === "practice" ? "practice" : "gpu",
    gpu: gpu === "integrated" || gpu === "no-webgpu" ? gpu : "ready",
    pace: parsePace(q.get("pace")),
    lost: positiveIntegerOrNull(q.get("lost")),
  };
}
