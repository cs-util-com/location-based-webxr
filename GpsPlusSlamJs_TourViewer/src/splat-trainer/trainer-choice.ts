/**
 * Which trainer the splat trainer page runs, from its address. Production
 * (no query) gets the unavailable trainer: the page reads recordings but
 * says it cannot make the splat yet. `?trainer=practice` asks for the
 * scripted practice trainer, which the page then shows as a practice run;
 * with it, `gpu=integrated` or `gpu=no-webgpu` makes its probe report that,
 * and `pace=<n>` runs it n times faster. Unknown values fall back to the
 * defaults, never to NaN.
 *
 * @see trainer-choice.ts.md
 */

import { parsePace } from "./fake-trainer.js";
import type { GpuProbe } from "./trainer-adapter.js";

export interface TrainerChoice {
  readonly practice: boolean;
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
    practice: q.get("trainer") === "practice",
    gpu: gpu === "integrated" || gpu === "no-webgpu" ? gpu : "ready",
    pace: parsePace(q.get("pace")),
    lost: positiveIntegerOrNull(q.get("lost")),
  };
}
