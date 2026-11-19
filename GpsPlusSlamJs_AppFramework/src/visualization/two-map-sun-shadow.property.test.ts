/**
 * Property test for the cached two-map sun shadow's render cadence, with
 * real three.js objects and no renderer.
 *
 * Why this test matters: the cached maps are only cheaper than per-frame
 * shadows if they render exactly on the update rule's events and never in
 * between. Over random sequences of orbits, pans, zoom steps, sun steps and
 * caster changes, every frame's requested renders must equal what the rule
 * says for that event: an orbit renders nothing, a pan past the re-centre
 * threshold or a zoom step renders only the near map, a sun step or a
 * caster change renders both.
 */
import fc from 'fast-check';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { snapShadowCentre, type CityBox } from './shadow-fit.js';
import type { Vec3 } from './sun-shadow-rig.js';
import {
  createTwoMapSunShadow,
  type TwoMapShadowInput,
} from './two-map-sun-shadow.js';

const DEG = Math.PI / 180;
const sunAt = (azDeg: number, elDeg: number): Vec3 => [
  Math.cos(elDeg * DEG) * Math.cos(azDeg * DEG),
  Math.sin(elDeg * DEG),
  Math.cos(elDeg * DEG) * Math.sin(azDeg * DEG),
];
const CITY: CityBox = { centre: [0, 0, 0], halfExtentM: 3000, maxHeightM: 80 };

type Event = 'orbit' | 'pan' | 'zoom' | 'sun' | 'caster';
/** What the rule renders per event: [near, far]. */
const EXPECTED: Record<Event, [boolean, boolean]> = {
  orbit: [false, false],
  pan: [true, false],
  zoom: [true, false],
  sun: [true, true],
  caster: [true, true],
};
/** Two camera distances whose near half widths are different steps. */
const DISTANCES = [200, 400] as const;
const HALF_WIDTH = { 200: 240, 400: 480 } as const;

describe('createTwoMapSunShadow: render cadence over event sequences', () => {
  it('requests exactly the renders the rule names for each event', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom<Event>('orbit', 'pan', 'zoom', 'sun', 'caster'),
          { minLength: 1, maxLength: 30 }
        ),
        fc.integer({ min: 0, max: 359 }),
        fc.boolean(),
        (events, azDeg, tierIsPhone) => {
          const scene = new THREE.Scene();
          const sun = new THREE.DirectionalLight();
          scene.add(sun, sun.target);
          const shadow = createTwoMapSunShadow({
            sun,
            parent: scene,
            tier: tierIsPhone ? 'phone' : 'high',
          });
          const farLight = shadow.farLight!;
          let elDeg = 30;
          let zoom = 0;
          let generation = 0;
          let target: Vec3 = [0, 0, 0];
          const frame = (): [boolean, boolean] => {
            const distance = DISTANCES[zoom]!;
            const input: TwoMapShadowInput = {
              sunDir: sunAt(azDeg, elDeg),
              target,
              cameraDistanceM: distance,
              city: CITY,
              casterGeneration: `build:${generation}`,
            };
            shadow.update(input);
            const got: [boolean, boolean] = [
              sun.shadow.needsUpdate,
              farLight.shadow.needsUpdate,
            ];
            sun.shadow.needsUpdate = false;
            farLight.shadow.needsUpdate = false;
            return got;
          };
          frame();
          let expectedRenders = 2;
          for (const event of events) {
            if (event === 'pan') {
              // A whole half width: always past the re-centre threshold.
              const R = HALF_WIDTH[DISTANCES[zoom]!];
              target = [target[0] + R, 0, target[2]];
            } else if (event === 'zoom') {
              zoom = 1 - zoom;
            } else if (event === 'sun') {
              elDeg = elDeg >= 50 ? elDeg - 1 : elDeg + 1;
            } else if (event === 'caster') {
              generation += 1;
            }
            const want = EXPECTED[event];
            expect(frame()).toEqual(want);
            expectedRenders += Number(want[0]) + Number(want[1]);
          }
          expect(shadow.renders).toBe(expectedRenders);
          shadow.dispose();
        }
      ),
      { numRuns: 100 }
    );
  });
});

type SunEvent =
  | { readonly kind: 'step'; readonly deg: number }
  | { readonly kind: 'jump'; readonly el: number }
  | { readonly kind: 'anchor'; readonly dx: number; readonly dz: number };

const sunEventArb: fc.Arbitrary<SunEvent> = fc.oneof(
  // Steps below the 0.05 degree render threshold and well above it.
  fc.record({
    kind: fc.constant('step' as const),
    deg: fc.oneof(
      fc.double({ min: -0.04, max: 0.04, noNaN: true }),
      fc.double({ min: -4, max: 4, noNaN: true })
    ),
  }),
  // Jumps cross the floor and the horizon both ways.
  fc.record({
    kind: fc.constant('jump' as const),
    el: fc.double({ min: -10, max: 60, noNaN: true }),
  }),
  fc.record({
    kind: fc.constant('anchor' as const),
    dx: fc.double({ min: -400, max: 400, noNaN: true }),
    dz: fc.double({ min: -400, max: 400, noNaN: true }),
  })
);

describe('createTwoMapSunShadow: the light follows the sun', () => {
  // Why: between near renders the light must shade from the CURRENT sun
  // (a slider step below the render threshold, a sun below the floor or the
  // horizon), while its target stays on the snapped centre the near map was
  // last rendered for. Dropping lightFollowsSun or the snap fails here.
  it('aims along the current sun from the last near render snapped centre', () => {
    fc.assert(
      fc.property(
        fc.array(sunEventArb, { minLength: 1, maxLength: 25 }),
        fc.integer({ min: 0, max: 359 }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        (events, azDeg, start) => {
          const scene = new THREE.Scene();
          const sun = new THREE.DirectionalLight();
          scene.add(sun, sun.target);
          const shadow = createTwoMapSunShadow({
            sun,
            parent: scene,
            tier: 'high',
          });
          let elDeg = 30;
          let target: Vec3 = [start, 0, -start / 3];
          let nearCentre: Vec3 | undefined;
          for (const event of [
            { kind: 'step', deg: 0 } as SunEvent,
            ...events,
          ]) {
            if (event.kind === 'step') {
              elDeg = Math.max(-10, Math.min(60, elDeg + event.deg));
            } else if (event.kind === 'jump') {
              elDeg = event.el;
            } else {
              target = [target[0] + event.dx, 0, target[2] + event.dz];
            }
            const sunDir = sunAt(azDeg, elDeg);
            const plan = shadow.update({
              sunDir,
              target,
              cameraDistanceM: 200,
              city: CITY,
              casterGeneration: 'build:1',
            });
            if (plan.near) {
              nearCentre = snapShadowCentre(target, sunDir, 240, 2048);
            }
            const want = nearCentre ?? target;
            const at = sun.target.position.toArray();
            for (let i = 0; i < 3; i += 1) {
              expect(at[i]).toBeCloseTo(want[i]!, 6);
            }
            const aim = sun.position
              .clone()
              .sub(sun.target.position)
              .normalize();
            const got = aim.toArray();
            for (let i = 0; i < 3; i += 1) {
              expect(got[i]).toBeCloseTo(sunDir[i]!, 9);
            }
          }
          shadow.dispose();
        }
      ),
      { numRuns: 150 }
    );
  });
});
