/**
 * The alignment presets the in-recording settings wheel switches between
 * (2026-09-02, rotation-first search plan D8/M3/M5).
 *
 * Each preset is a whole candidate config in the library's PUBLIC override
 * names, applied through `setAlignmentOverrides` - one dispatch replaces the
 * previous preset entirely, so a preset carries only what it changes from the
 * shipped defaults and `null` (the shipped entry) clears everything.
 *
 * WHERE THE NUMBERS COME FROM. The first three candidates are the
 * rotation-first scorecard's non-dominated set (private repo, findings F3,
 * 2026-09-01): each beat the shipped config on every rotation axis at equal
 * position within noise. The full search (stage 2, 2026-09-02, findings G3)
 * confirmed the first two as its only survivors and added the FIELD-JUDGEMENT
 * block: rows that are calmer within a walk than anything surviving, and that
 * failed the search's cross-session guardrail by the amount in their label
 * (two walks of the same street agree that much less about where distant
 * content points than under shipped, on one building). Whether that trade is
 * worth it is exactly what the wheel exists to let the owner see. Nothing
 * here is a promotion - the shipped config stays the default.
 */

import type { AlignmentOverrides } from 'gps-plus-slam-app-framework/state';

export interface AlignmentPreset {
  /** Stable id, also the dropdown value; never renumbered. */
  readonly id: string;
  /** Short label as shown in the wheel's dropdown, outdoors, on a phone. */
  readonly label: string;
  /** `null` = the shipped defaults (clears any preset). */
  readonly overrides: AlignmentOverrides | null;
}

export const SHIPPED_PRESET_ID = 'shipped';

export const ALIGNMENT_PRESETS: readonly AlignmentPreset[] = [
  { id: SHIPPED_PRESET_ID, label: 'shipped (250 / 5)', overrides: null },
  // Scorecard candidate 1: one knob, ≥ shipped everywhere measured.
  { id: 'f100', label: 'memory 100', overrides: { timeWeightFactor: 100 } },
  // Candidate 2: plus a 1.8° cut in the bad-GPS yaw swing.
  {
    id: 'f100-exp075',
    label: 'memory 100, accuracy 0.75',
    overrides: { timeWeightFactor: 100, gpsAccuracyExponent: 0.75 },
  },
  // Candidate 3: calm-but-consistent, paying +0.36 m of position. Stage 2:
  // rotSS 0.180, bgPeak 4.97, agreement −2.1° (fails the guardrail).
  {
    id: 'f25-exp075',
    label: 'memory 25, accuracy 0.75 (agreement −2.1°)',
    overrides: { timeWeightFactor: 25, gpsAccuracyExponent: 0.75 },
  },
  // ---- Field-judgement block (stage 2, findings G3). Labels carry the cost.
  // Calmest row in the search: rotSS 0.147 (shipped 0.217), bgPeak 3.96
  // (shipped 8.03), markP90 6.87 (+0.7 m), agreement −4.4°.
  {
    id: 'calm-ret04',
    label: 'no recency, keep 40 % (calmest; agreement −4.4°)',
    overrides: { timeWeightEnabled: false, outlierRetainRatio: 0.4 },
  },
  // Short memory without rejection: rotSS 0.171, bgPeak 4.49, markP90 6.80,
  // agreement −2.3°.
  {
    id: 'f25-none-exp1',
    label: 'memory 25, no rejection, accuracy 1 (agreement −2.3°)',
    overrides: {
      timeWeightFactor: 25,
      outlierRejectionEnabled: false,
      gpsAccuracyExponent: 1,
    },
  },
  // Short memory with a wide threshold: rotSS 0.173, bgPeak 4.68, markP90
  // 6.59, agreement −4.4°.
  {
    id: 'f25-thr7-ret04-exp1',
    label: 'memory 25, threshold 7, keep 40 %, accuracy 1 (agreement −4.4°)',
    overrides: {
      timeWeightFactor: 25,
      outlierThresholdMeters: 7,
      outlierRetainRatio: 0.4,
      gpsAccuracyExponent: 1,
    },
  },
];

/** Look a preset up by id; `undefined` for an unknown id (never a default). */
export function findAlignmentPreset(id: string): AlignmentPreset | undefined {
  return ALIGNMENT_PRESETS.find((p) => p.id === id);
}
