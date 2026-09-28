// Repo-meta test: the globe lab's hand-over link agrees with OsmDemo.
//
// WHY IT NEEDS A GUARD. The globe's pin opens OsmDemo's city with a link it
// builds itself (`GpsPlusSlamJs_Globe/src/globe-handover.ts`), and the globe
// package does not depend on the demo, so it writes the demo's numbers out
// (`OSM_HANDOVER`): the camera distance the demo accepts, the far plane and
// fog it boots with, the sun elevation its sky can draw, and the way its
// clock prints a time. Each copy is right today and each goes wrong
// SILENTLY when the demo moves: a `cdist` above the demo's maximum is
// refused and the default view opens; a hand-over distance past the fog's
// start opens a city in fog (the milestone review of the pin found exactly
// that at 4800 m); a time the demo reads differently lands a minute off.
// Nothing renders an error in any of these cases. (Milestone review of the
// pin, 2026-09-28, finding m1.)
//
// WHAT IT CHECKS. Each copy against the demo's source text, and the
// hand-over distance against the fog bound derived from the demo's own
// constants, not from the copies.
//
// WHAT IT CANNOT DO: it reads source text with patterns, so a constant that
// the demo starts computing from other constants is reported as missing
// (a loud failure, which is the right direction); and it checks the far
// plane the demo BOOTS with, not one a user dials later.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8');

/** The number assigned by `<name> = <number>` or `<name>: <number>`. */
export function numberAssigned(source, name) {
  const m = new RegExp(
    `\\b${name}\\s*[:=]\\s*(-?[\\d_]+(?:\\.\\d+)?)\\b`
  ).exec(source);
  return m ? Number(m[1].replaceAll('_', '')) : undefined;
}

const HANDOVER = read('GpsPlusSlamJs_Globe/src/globe-handover.ts');
const copy = (key) => numberAssigned(HANDOVER, key);

const demo = {
  maxDistanceM: numberAssigned(
    read('GpsPlusSlamJs_OsmDemo/src/url-state.ts'),
    'MAX_DISTANCE_M'
  ),
  farPlaneM: numberAssigned(
    read('GpsPlusSlamJs_OsmDemo/src/building-view.ts'),
    'FAR_PLANE_M'
  ),
  fogNearRatio: numberAssigned(
    read('GpsPlusSlamJs_OsmDemo/src/building-view.ts'),
    'FOG_NEAR_RATIO'
  ),
  renderMultiplier: numberAssigned(
    read('GpsPlusSlamJs_OsmDemo/src/render-distance.ts'),
    'DEFAULT_RENDER_MULTIPLIER'
  ),
  minSunElevationDeg: numberAssigned(
    read('GpsPlusSlamJs_OsmDemo/src/sun-clock.ts'),
    'minElevationDeg'
  ),
};

describe('the globe hand-over contract with OsmDemo', () => {
  it('reads every number it checks (so the guard is not vacuous)', () => {
    expect(numberAssigned('const X_M = 4_800;', 'X_M')).toBe(4800);
    expect(numberAssigned('{ y: -6, }', 'y')).toBe(-6);
    expect(numberAssigned('const Z = 0.66;', 'Z')).toBe(0.66);
    for (const [name, value] of Object.entries(demo)) {
      expect(value, `OsmDemo's ${name}`).toEqual(expect.any(Number));
    }
    for (const key of [
      'maxCameraDistanceM',
      'farPlaneM',
      'fogNearRatio',
      'minSunElevationDeg',
      'tileHalfM',
      'cameraDistanceM',
    ]) {
      expect(copy(key), `OSM_HANDOVER.${key}`).toEqual(expect.any(Number));
    }
  });

  it('copies the demo\'s camera ceiling, boot far plane, fog ratio and sun floor', () => {
    expect(copy('maxCameraDistanceM')).toBe(demo.maxDistanceM);
    expect(copy('farPlaneM')).toBe(demo.farPlaneM * demo.renderMultiplier);
    expect(copy('fogNearRatio')).toBe(demo.fogNearRatio);
    expect(copy('minSunElevationDeg')).toBe(demo.minSunElevationDeg);
  });

  it('hands over inside the demo\'s fog start, derived from the demo\'s own far plane', () => {
    const fogNearM = demo.fogNearRatio * demo.farPlaneM * demo.renderMultiplier;
    expect(copy('cameraDistanceM') + copy('tileHalfM')).toBeLessThanOrEqual(
      fogNearM
    );
    expect(copy('cameraDistanceM')).toBeLessThanOrEqual(demo.maxDistanceM);
  });

  it('prints the solar time the way the demo prints and reads it', () => {
    // The demo floors the minutes with a 1e-6 tolerance
    // (`formatSolarClock`), so an instant booted at HH:MM reads HH:MM; the
    // hand-over must round the same way or its link lands a minute early.
    expect(read('GpsPlusSlamJs_OsmDemo/src/sun-clock.ts')).toMatch(
      /Math\.floor\(minutes \+ 1e-6\)/
    );
    expect(HANDOVER).toMatch(/Math\.floor\(hours \* 60 \+ 1e-6\)/);
  });
});
