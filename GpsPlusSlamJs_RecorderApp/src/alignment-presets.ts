/**
 * The alignment presets the in-recording settings wheel switches between
 * (2026-09-02, rotation-first search plan D8/M3/M5).
 *
 * Each preset is a whole candidate config in the library's PUBLIC override
 * names, applied through `setAlignmentOverrides` - one dispatch replaces the
 * previous preset entirely, so a preset carries only what it changes from the
 * shipped defaults and `null` (the shipped entry) clears everything.
 *
 * READING "RECENCY N". `timeWeightFactor` is the steepness of the recency
 * penalty on old fixes, not a memory length: a fix weighs
 * `1 / (1/w + factor · age/oldestAge + 1)`, so LARGER is SHORTER memory (old
 * fixes count less). Shipped 250 is the short end of the searched range;
 * recency 100 and 25 are flatter penalties, i.e. longer memory; "no recency"
 * weighs every fix the same and is the longest of all. The labels say the
 * direction because the first draft had it inverted (owner question,
 * 2026-09-02 22:20).
 *
 * WHERE THE NUMBERS COME FROM. The first three candidates are the
 * rotation-first scorecard's non-dominated set (private repo, findings F3,
 * 2026-09-01): each beat the shipped config on every rotation axis at equal
 * position within noise. The full search (stage 2, 2026-09-02, findings G3)
 * confirmed the first two as its only survivors and added the FIELD-JUDGEMENT
 * block: rows that are calmer within a walk than anything surviving, and that
 * failed the search's cross-session guardrail by the amount in their label
 * (two walks of the same street agree that much less about where distant
 * content points than under shipped, on one building). Read together the
 * table is monotone: the longer the memory, the calmer the yaw within a walk
 * and the more two walks disagree, because a long-memory solve keeps its
 * earlier fixes as ballast. Whether that trade is worth it is exactly what the
 * wheel exists to let the owner see. Nothing here is a promotion - the shipped
 * config stays the default.
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
  {
    id: SHIPPED_PRESET_ID,
    label: 'shipped (recency 250, threshold 5)',
    overrides: null,
  },
  // Scorecard candidate 1 / stage-2 survivor: one knob, ≥ shipped everywhere
  // measured. rotSS 0.204 (shipped 0.217), bgPeak 7.21, agreement +0.4°.
  {
    id: 'f100',
    label: 'recency 100 (longer memory)',
    overrides: { timeWeightFactor: 100 },
  },
  // Candidate 2 / stage-2 rank 1: plus a 1.8° cut in the bad-GPS yaw swing.
  // rotSS 0.197, bgPeak 6.22, agreement +0.9°.
  {
    id: 'f100-exp075',
    label: 'recency 100, accuracy 0.75 (longer memory)',
    overrides: { timeWeightFactor: 100, gpsAccuracyExponent: 0.75 },
  },
  // Candidate 3: calm-but-consistent, paying +0.36 m of position. Stage 2:
  // rotSS 0.180, bgPeak 4.97, agreement −2.1° (fails the guardrail).
  {
    id: 'f25-exp075',
    label: 'recency 25, accuracy 0.75 (long memory; agreement −2.1°)',
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
  // Longest memory without any rejection: rotSS 0.158, bgPeak 3.54, markP90
  // 7.29 (+1.1 m, over the +1.0 m allowance), agreement −2.8°. Added at the
  // owner's request (22:15) so the no-rejection end of the grid is on the
  // phone too.
  {
    id: 'calm-none-exp075',
    label: 'no recency, no rejection, accuracy 0.75 (agreement −2.8°, +1.1 m)',
    overrides: {
      timeWeightEnabled: false,
      outlierRejectionEnabled: false,
      gpsAccuracyExponent: 0.75,
    },
  },
  // Long memory without rejection: rotSS 0.171, bgPeak 4.49, markP90 6.80,
  // agreement −2.3°.
  {
    id: 'f25-none-exp1',
    label: 'recency 25, no rejection, accuracy 1 (agreement −2.3°)',
    overrides: {
      timeWeightFactor: 25,
      outlierRejectionEnabled: false,
      gpsAccuracyExponent: 1,
    },
  },
  // Long memory with a wide threshold: rotSS 0.173, bgPeak 4.68, markP90
  // 6.59, agreement −4.4°.
  {
    id: 'f25-thr7-ret04-exp1',
    label: 'recency 25, threshold 7, keep 40 %, accuracy 1 (agreement −4.4°)',
    overrides: {
      timeWeightFactor: 25,
      outlierThresholdMeters: 7,
      outlierRetainRatio: 0.4,
      gpsAccuracyExponent: 1,
    },
  },
  // The robust-solver arm: its calmest stage-1 cell (rotSS 0.205 against
  // shipped 0.197 on the 91-recording subset, inside noise; never among the
  // 30 calmest, so it did not reach stage 2). Here so the wheel's heading-penalty box has a
  // preset that makes it act - the compass-guided variant the owner asked for
  // regardless of the offline score (plan D6).
  {
    id: 'f50-robust-exp1',
    label: 'recency 50, robust solver, accuracy 1 (enables heading penalty)',
    overrides: {
      timeWeightFactor: 50,
      consensusSolverEnabled: true,
      gpsAccuracyExponent: 1,
    },
  },
];

/** Look a preset up by id; `undefined` for an unknown id (never a default). */
export function findAlignmentPreset(id: string): AlignmentPreset | undefined {
  return ALIGNMENT_PRESETS.find((p) => p.id === id);
}
