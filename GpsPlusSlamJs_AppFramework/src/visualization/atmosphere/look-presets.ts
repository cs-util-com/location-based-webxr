/**
 * Named looks for the atmosphere: where the sun is, how clear the air is, how
 * cloudy, and the exposure a camera would pick for it.
 *
 * DATA, NOT CODE, and validated as such: every field here reaches a shader or a
 * light, and a bad value renders black without an error. `validateLookPreset`
 * names the field, so a broken edit says what broke.
 *
 * ANGLES use the demos' compass convention (OsmDemo `sun-position.ts`):
 * elevation above the horizon, azimuth clockwise from north. Converting them
 * to a direction is the caller's job (today the look-dev page, through
 * `sunDirection`), so the convention has one implementation.
 *
 * EXPOSURE is a compensation in EV (`SkyAtmosphere.setExposureCompensation`)
 * on top of the auto-exposure, natural light only. The values are starting
 * points chosen by eye on the look-dev page, expected to move in taste rounds.
 *
 * @see look-presets.ts.md
 */

export interface LookPreset {
  readonly id: string;
  readonly label: string;
  /** Degrees above the horizon; negative is below. */
  readonly sunElevationDeg: number;
  /** Degrees clockwise from north. */
  readonly sunAzimuthDeg: number;
  /** Meteorological visibility, km. */
  readonly visibilityKm: number;
  /** 0 = clear sky, 1 = overcast. */
  readonly cloudCover: number;
  /** Exposure compensation in EV on top of the auto-exposure (natural light only). */
  readonly exposureEv: number;
}

export const LOOK_PRESETS: readonly LookPreset[] = [
  {
    id: 'dawn',
    label: 'Dawn',
    sunElevationDeg: 2,
    sunAzimuthDeg: 75,
    visibilityKm: 30,
    cloudCover: 0.25,
    exposureEv: 0,
  },
  {
    id: 'noon',
    label: 'Noon',
    sunElevationDeg: 58,
    sunAzimuthDeg: 180,
    visibilityKm: 60,
    cloudCover: 0.2,
    exposureEv: 0,
  },
  {
    id: 'golden',
    label: 'Golden hour',
    sunElevationDeg: 5,
    sunAzimuthDeg: 265,
    visibilityKm: 45,
    cloudCover: 0.3,
    exposureEv: -0.3,
  },
  {
    id: 'blueHour',
    label: 'Blue hour',
    sunElevationDeg: -4,
    sunAzimuthDeg: 280,
    visibilityKm: 60,
    cloudCover: 0.15,
    exposureEv: -1,
  },
  {
    id: 'hazy',
    label: 'Hazy',
    sunElevationDeg: 35,
    sunAzimuthDeg: 150,
    visibilityKm: 12,
    cloudCover: 0.5,
    exposureEv: 0,
  },
];

function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/** Every problem with a preset, each naming its field. Empty means valid. */
export function validateLookPreset(preset: LookPreset): string[] {
  const problems: string[] = [];
  if (!inRange(preset.sunElevationDeg, -90, 90)) {
    problems.push(
      `sunElevationDeg ${preset.sunElevationDeg} is outside [-90, 90]`
    );
  }
  if (!inRange(preset.sunAzimuthDeg, 0, 360)) {
    problems.push(`sunAzimuthDeg ${preset.sunAzimuthDeg} is outside [0, 360]`);
  }
  if (!(Number.isFinite(preset.visibilityKm) && preset.visibilityKm > 0)) {
    problems.push(`visibilityKm ${preset.visibilityKm} must be positive`);
  }
  if (!inRange(preset.cloudCover, 0, 1)) {
    problems.push(`cloudCover ${preset.cloudCover} is outside [0, 1]`);
  }
  if (!inRange(preset.exposureEv, -8, 8)) {
    problems.push(`exposureEv ${preset.exposureEv} is outside [-8, 8]`);
  }
  return problems;
}
