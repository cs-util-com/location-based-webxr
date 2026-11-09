/**
 * Why this test matters: a block inside a plain folder has its pose in the
 * folder's frame, and the world view composes the folder's pose in
 * (`tourFreeBlocks`). An editor that moves such a block must turn the
 * world pose back into the folder's frame, so composing then decomposing
 * has to return the block's own pose - otherwise every save would drift it.
 * The tolerances are declared and the offsets swept from a centimetre to
 * the format's 10 km bound. A folder is a rigid frame: its scale is always
 * 1 (the reader takes no other value until a renderer scales a whole
 * group), so nothing here scales. A folder with no pose must change
 * nothing at all, bit for bit: most folders will be that. Two nested
 * folders whose turns do not commute are checked against a result worked
 * out by hand, an oracle independent of the code: composing in the wrong
 * order gives another answer.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Quaternion } from 'gps-plus-slam-js';

import type { TourBlock } from './tour-blocks';
import {
  composeTourFolderPath,
  composeTourFolderPose,
  decomposeTourFolderPose,
} from './tour-folder-pose';
import type { TourLocalPose } from './tour-items';
import { tourFreeBlocks } from './tour-station-pose';
import type { TourFolder, TourStationChild } from './tour-story';

/** A unit quaternion from three uniform numbers (Shoemake), so every
 *  rotation is drawn, not only turns about Up. */
const rotationArbitrary: fc.Arbitrary<Quaternion> = fc
  .tuple(
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
    fc.double({ min: 0, max: 2 * Math.PI, noNaN: true })
  )
  .map(([u, a, b]): Quaternion => {
    const s = Math.sqrt(1 - u);
    const t = Math.sqrt(u);
    return [s * Math.sin(a), s * Math.cos(a), t * Math.sin(b), t * Math.cos(b)];
  });

const coordinate = (reach: number) =>
  fc.double({ min: -reach, max: reach, noNaN: true });

const poseArbitrary = (reach: number): fc.Arbitrary<TourLocalPose> =>
  fc.record({
    position: fc.tuple(coordinate(reach), coordinate(reach), coordinate(reach)),
    rotation: rotationArbitrary,
  });

/** How far apart two rotations are: 1 - |q1.q2| (q and -q are one). */
function rotationGap(a: Quaternion, b: Quaternion): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 1 - Math.min(1, dot);
}

function positionGap(a: TourLocalPose, b: TourLocalPose): number {
  return Math.hypot(
    a.position[0] - b.position[0],
    a.position[1] - b.position[1],
    a.position[2] - b.position[2]
  );
}

// The declared tolerances: a micrometre on the position (the station
// frame's own round trip is bounded at that order), and 1e-12 on
// 1 - |q1.q2| (about 1.4 microradians of turn). Double precision leaves
// orders of magnitude of room at every reach swept.
const POSITION_TOLERANCE_M = 1e-6;
const ROTATION_TOLERANCE = 1e-12;

const IDENTITY: Quaternion = [0, 0, 0, 1];
// A quarter turn about Up (y), and one about North (x). They do not
// commute: the order a nest composes them in changes the result.
const S = Math.SQRT1_2;
const QUARTER_ABOUT_UP: Quaternion = [0, S, 0, S];
const QUARTER_ABOUT_NORTH: Quaternion = [S, 0, 0, S];

describe('composing a folder pose (properties)', () => {
  // Swept: the reach of the offsets, folder and child alike.
  const REACHES = [0.01, 1, 100, 10_000];
  for (const reach of REACHES) {
    it(`compose then decompose returns the pose (offsets up to ${String(reach)} m)`, () => {
      fc.assert(
        fc.property(
          poseArbitrary(reach),
          poseArbitrary(reach),
          (folderPose, pose) => {
            const folder = { pose: folderPose };
            const back = decomposeTourFolderPose(
              folder,
              composeTourFolderPose(folder, pose)
            );
            expect(positionGap(back, pose)).toBeLessThanOrEqual(
              POSITION_TOLERANCE_M
            );
            expect(
              rotationGap(back.rotation, pose.rotation)
            ).toBeLessThanOrEqual(ROTATION_TOLERANCE);
          }
        ),
        { numRuns: 200 }
      );
    });
  }

  it('the composed pose is where the folder puts it: offset turned, then moved', () => {
    // A quarter turn about Up maps North [1, 0, 0] onto [0, 0, -1].
    const out = composeTourFolderPose(
      { pose: { position: [10, 1, 20], rotation: QUARTER_ABOUT_UP } },
      { position: [1, 0, 0], rotation: IDENTITY }
    );
    expect(out.position[0]).toBeCloseTo(10, 12);
    expect(out.position[1]).toBeCloseTo(1, 12);
    expect(out.position[2]).toBeCloseTo(20 - 1, 12);
    expect(rotationGap(out.rotation, QUARTER_ABOUT_UP)).toBeLessThan(1e-15);
  });

  it('no pose is the identity, bit for bit, and so is an empty path', () => {
    fc.assert(
      fc.property(poseArbitrary(10_000), (pose) => {
        expect(composeTourFolderPose({}, pose)).toBe(pose);
        expect(decomposeTourFolderPose({}, pose)).toBe(pose);
        expect(composeTourFolderPath([], pose)).toBe(pose);
        expect(composeTourFolderPath([{}, {}], pose)).toBe(pose);
      })
    );
  });
});

describe('flattening plain folders into free blocks', () => {
  const block = (
    id: string,
    position: [number, number, number]
  ): TourBlock => ({
    id,
    kind: 'shortText',
    view: 'pin',
    caption: id,
    pose: { position, rotation: IDENTITY },
  });

  it('composes nested folders innermost first, in document order', () => {
    const inner: TourFolder = {
      id: 'inner',
      kind: 'folder',
      pose: { position: [0, 0, 5], rotation: IDENTITY },
      children: [block('b', [1, 0, 0])],
    };
    const outer: TourFolder = {
      id: 'outer',
      kind: 'folder',
      pose: { position: [100, 0, 0], rotation: IDENTITY },
      scale: 1,
      children: [block('a', [1, 0, 0]), inner],
    };
    const children: TourStationChild[] = [block('top', [7, 0, 0]), outer];
    const free = tourFreeBlocks({ children });
    expect(free.map((b) => b.id)).toEqual(['top', 'a', 'b']);
    // b: the inner folder puts it at [1, 0, 5]; the outer adds 100 north.
    expect(free.map((b) => b.pose.position)).toEqual([
      [7, 0, 0],
      [101, 0, 0],
      [101, 0, 5],
    ]);
  });

  it('composes two nested folders whose turns do not commute, as worked out by hand', () => {
    // By hand, with R_up(90) [x, y, z] = [z, y, -x] and
    // R_north(90) [x, y, z] = [x, -z, y]:
    //   inner: [0, 0, 5] + R_up(90) [1, 2, 3] = [0, 0, 5] + [3, 2, -1]
    //        = [3, 2, 4];
    //   outer: [100, 0, 0] + R_north(90) [3, 2, 4] = [100, 0, 0] + [3, -4, 2]
    //        = [103, -4, 2].
    // The turn is q_north * q_up = [1/2, 1/2, 1/2, 1/2]; the other order,
    // q_up * q_north, is [1/2, 1/2, -1/2, 1/2], and composing outermost
    // first puts the block at [2, -3, -96]: a wrong walker fails both.
    const inner: TourFolder = {
      id: 'inner',
      kind: 'folder',
      pose: { position: [0, 0, 5], rotation: QUARTER_ABOUT_UP },
      children: [block('b', [1, 2, 3])],
    };
    const outer: TourFolder = {
      id: 'outer',
      kind: 'folder',
      pose: { position: [100, 0, 0], rotation: QUARTER_ABOUT_NORTH },
      children: [inner],
    };
    const free = tourFreeBlocks({ children: [outer] });
    expect(free).toHaveLength(1);
    const pose = free[0]?.pose;
    if (pose === undefined) throw new Error('no block');
    const expected = [103, -4, 2];
    pose.position.forEach((v, i) => {
      expect(v).toBeCloseTo(expected[i] ?? Number.NaN, 12);
    });
    expect(rotationGap(pose.rotation, [0.5, 0.5, 0.5, 0.5])).toBeLessThan(
      1e-15
    );
    // The path helper the reader bounds offsets with agrees exactly.
    expect(
      composeTourFolderPath([outer, inner], block('b', [1, 2, 3]).pose)
    ).toEqual(pose);
  });

  it('a block outside any folder is handed on as it is', () => {
    const top = block('top', [1, 2, 3]);
    expect(tourFreeBlocks({ children: [top] })[0]).toBe(top);
  });
});
