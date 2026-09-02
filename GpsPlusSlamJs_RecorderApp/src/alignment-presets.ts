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
 * position within noise. The stage-2 winners of the full search are appended
 * by the search itself (plan M5) with their measured columns in the docs.
 * Nothing here is a promotion - the shipped config stays the default and the
 * owner judges the rest in the field.
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
  // Candidate 3: calm-but-consistent, paying +0.36 m of position.
  {
    id: 'f25-exp075',
    label: 'memory 25, accuracy 0.75',
    overrides: { timeWeightFactor: 25, gpsAccuracyExponent: 0.75 },
  },
];

/** Look a preset up by id; `undefined` for an unknown id (never a default). */
export function findAlignmentPreset(id: string): AlignmentPreset | undefined {
  return ALIGNMENT_PRESETS.find((p) => p.id === id);
}
