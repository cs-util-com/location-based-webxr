/**
 * Tests for the two-map shadow's light-loop chunk, against the REAL chunk
 * of the three this package depends on, not a copy.
 *
 * Why this file matters: the far city is shadowed by a second, coarse map
 * that the sun samples outside its sharp near map. That lives in a text
 * replacement of three's `lights_fragment_begin`, so a three upgrade that
 * rewords the shadow line would silently leave the far city unshadowed;
 * and a fade constant that drifted from the one the far-plane fit assumes
 * would put a seam where the near map ends.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { FADE_START_DEPTH } from './shadow-fit.js';
import { FADE_END_DEPTH, withTwoMapShadow } from './two-map-shadow.js';

const CHUNK = THREE.ShaderChunk.lights_fragment_begin;

describe('withTwoMapShadow', () => {
  it('gives the sun (light 0) both maps, only while two shadows exist', () => {
    const out = withTwoMapShadow(CHUNK);
    expect(out).toMatch(
      /NUM_DIR_LIGHT_SHADOWS >= 2 && UNROLLED_LOOP_INDEX == 0/
    );
    expect(out).toContain('directionalShadowMap[ 0 ]');
    expect(out).toContain('directionalShadowMap[ 1 ]');
    // The far light's own lookup is skipped: it carries no light.
    expect(out).toMatch(
      /NUM_DIR_LIGHT_SHADOWS >= 2 && UNROLLED_LOOP_INDEX == 1\n\t\t#elif/
    );
  });

  // At a 5 degree sun, ground 500 m out along the sun's azimuth lies 44 m
  // off the ray, inside the near square: a lateral-only test reads it lit
  // from beyond the near map's depth.
  it('chooses the near map by its whole frustum, fading before the depth end', () => {
    const out = withTwoMapShadow(CHUNK);
    expect(out).toContain('step( 0.0, nearCoord.z )');
    expect(out).toContain(
      `( 1.0 - smoothstep( ${FADE_START_DEPTH}, ${FADE_END_DEPTH}, nearCoord.z ) )`
    );
    expect(FADE_START_DEPTH).toBe(0.98);
    expect(FADE_END_DEPTH).toBeLessThan(1);
  });

  it("keeps three's own shadow line for every other case", () => {
    const line =
      'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]';
    expect(CHUNK).toContain(line);
    expect(withTwoMapShadow(CHUNK)).toContain(line);
  });

  it('is idempotent', () => {
    const once = withTwoMapShadow(CHUNK);
    expect(withTwoMapShadow(once)).toBe(once);
  });

  it('refuses a chunk it does not recognise, rather than doing nothing', () => {
    expect(() => withTwoMapShadow('void main() {}')).toThrow(
      /lights_fragment_begin/
    );
    expect(() => withTwoMapShadow(undefined as unknown as string)).toThrow(
      TypeError
    );
  });
});
