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
  // ---- THE MEMORY LADDER (2026-09-12). One variable: how far back the solver
  // is allowed to look. Every rung sets timeWeightEnabled:false, because with
  // recency decay left running the oldest fix INSIDE a 90 s window is still
  // weighted 251x lighter than the newest - so the window would not be the
  // variable. That exact confound wasted an arm in the offline probe; on the
  // phone it would waste a walk.
  //
  // WHAT THE OFFLINE EVIDENCE ACTUALLY SAYS, after adversary review on
  // 2026-09-12 - and it is the opposite of what the first version of these
  // labels claimed. The motion metric that ranked "no window" best SCORES LESS
  // MOTION AS BETTER, and an alignment that has stopped responding to GPS also
  // moves less: its ranking correlates with "which arm moved least" at Spearman
  // +0.943. On the in-sample GPS residual, every rung from w90 outward is worse
  // than shipped on 159 of 159 recordings, and there is not one recording where
  // wall beats shipped on both instruments.
  //
  // The ladder is therefore a QUESTION, not a recommendation, and the question
  // it asks the tester is NOT "which feels steadiest". A frozen alignment feels
  // beautifully steady. It is "after a long walk, does the content still sit on
  // the right spot" - because that is the axis where these rungs are predicted
  // to fail, and the only instrument that can settle it is a human looking at a
  // real place.
  {
    id: 'w45',
    label: 'no recency, last 45 s',
    overrides: { timeWeightEnabled: false, recentWindowSeconds: 45 },
  },
  {
    id: 'w90',
    label: 'no recency, last 90 s',
    overrides: { timeWeightEnabled: false, recentWindowSeconds: 90 },
  },
  {
    id: 'w180',
    label: 'no recency, last 180 s',
    overrides: { timeWeightEnabled: false, recentWindowSeconds: 180 },
  },
  {
    id: 'w300',
    label: 'no recency, last 300 s',
    overrides: { timeWeightEnabled: false, recentWindowSeconds: 300 },
  },
  // No window key at all, deliberately: there is no public override that sets
  // useOnlyRecentData back to false, so this rung relies on the shipped default
  // plus setAlignmentOverrides REPLACING rather than merging. A test pins that.
  {
    id: 'wall',
    label: 'no recency, whole recording',
    overrides: { timeWeightEnabled: false },
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
