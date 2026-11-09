/**
 * Why this test matters: a block inside a plain folder has its pose in the
 * folder's frame, and the world view composes the folder's pose and scale
 * in (`tourFreeBlocks`). An editor that moves such a block must turn the
 * world pose back into the folder's frame, so composing then decomposing
 * has to return the block's own pose - otherwise every save would drift it.
 * The tolerance is declared and swept below, with rotations, offsets from a
 * centimetre to the format's 10 km bound and scales 0.25-4 (the range a
 * group is likely to be resized in). A folder with no pose and no scale
 * must change nothing at all, bit for bit: most folders will be that.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Quaternion } from 'gps-plus-slam-js';

import type { TourBlock } from './tour-blocks';
import type { TourLocalPose } from './tour-items';
import {
  composeTourFolderPose,
  decomposeTourFolderPose,
  tourFlatFreeBlocks,
  tourFreeBlocks,
} from './tour-station-pose';
import type { TourFolder, TourStationChild } from './tour-story';

/** A unit quaternion from three uniform numbers (Shoemake), so every
 *  rotation is drawn, not only turns about Up. */
const rotationArbitrary: fc.Arbitrary<Quaternion> = fc
  .tuple(
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
    fc.double({ min: 0, max: 2 * Math.PI, noNaN: true })
  )
  .map(([u, a, b]) => {
    const s = Math.sqrt(1 - u);
    const t = Math.sqrt(u);
    return [s * Math.sin(a), s * Math.cos(a), t * Math.sin(b), t * Math.cos(b)];
  });

const offset = (reach: number) =>
  fc.tuple(
    fc.double({ min: -reach, max: reach, noNaN: true }),
    fc.double({ min: -reach, max: reach, noNaN: true }),
    fc.double({ min: -reach, max: reach, noNaN: true })
  );

const poseArbitrary = (reach: number): fc.Arbitrary<TourLocalPose> =>
  fc.record({ position: offset(reach), rotation: rotationArbitrary });

/** The same rotation: q and -q are one. */
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
// pose's own round trip is bounded at that order), and 1e-12 on
// 1 - |q1.q2| (about 1.4 microradians of turn). Double precision leaves
// orders of magnitude of room: the sweep records the worst gap seen.
const POSITION_TOLERANCE_M = 1e-6;
const ROTATION_TOLERANCE = 1e-12;

describe('composing a folder pose (properties)', () => {
  // Swept: the reach of the offsets (folder and child alike) and the scale.
  const REACHES = [0.01, 1, 100, 10_000];
  const SCALES = [0.25, 0.5, 1, 2, 4];
  for (const reach of REACHES) {
    for (const scale of SCALES) {
      it(`compose then decompose returns the pose (offsets up to ${String(reach)} m, scale ${String(scale)})`, () => {
        let worstPosition = 0;
        let worstRotation = 0;
        fc.assert(
          fc.property(
            poseArbitrary(reach),
            poseArbitrary(reach),
            (folderPose, pose) => {
              const folder = { pose: folderPose, scale };
              const back = decomposeTourFolderPose(
                folder,
                composeTourFolderPose(folder, pose)
              );
              const p = positionGap(back, pose);
              const r = rotationGap(back.rotation, pose.rotation);
              worstPosition = Math.max(worstPosition, p);
              worstRotation = Math.max(worstRotation, r);
              expect(p).toBeLessThanOrEqual(POSITION_TOLERANCE_M);
              expect(r).toBeLessThanOrEqual(ROTATION_TOLERANCE);
            }
          ),
          { numRuns: 200 }
        );
        // The bound holds with room: at the widest reach and smallest
        // scale the error is still far under the tolerance.
        expect(worstPosition).toBeLessThan(POSITION_TOLERANCE_M / 100);
        expect(worstRotation).toBeLessThan(ROTATION_TOLERANCE);
      });
    }
  }

  it('the composed pose is where the folder puts it: offset scaled, turned and moved', () => {
    // A quarter turn about Up (+90 deg yaw) maps North onto -East in the
    // NUE frame: [x, y, z] -> [-z, y, x] for this quaternion.
    const quarter: Quaternion = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    const out = composeTourFolderPose(
      { pose: { position: [10, 1, 20], rotation: quarter }, scale: 2 },
      { position: [1, 0, 0], rotation: [0, 0, 0, 1] }
    );
    expect(out.position[0]).toBeCloseTo(10, 12);
    expect(out.position[1]).toBeCloseTo(1, 12);
    expect(out.position[2]).toBeCloseTo(20 - 2, 12);
    expect(rotationGap(out.rotation, quarter)).toBeLessThan(1e-15);
  });

  it('no pose and scale 1 (or none) are the identity, bit for bit', () => {
    fc.assert(
      fc.property(poseArbitrary(10_000), (pose) => {
        for (const folder of [{}, { scale: 1 }]) {
          expect(composeTourFolderPose(folder, pose)).toBe(pose);
          expect(decomposeTourFolderPose(folder, pose)).toBe(pose);
        }
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
    pose: { position, rotation: [0, 0, 0, 1] },
  });

  it('composes nested folders innermost first and multiplies their scales', () => {
    const inner: TourFolder = {
      id: 'inner',
      kind: 'folder',
      pose: { position: [0, 0, 5], rotation: [0, 0, 0, 1] },
      scale: 3,
      children: [block('b', [1, 0, 0])],
    };
    const outer: TourFolder = {
      id: 'outer',
      kind: 'folder',
      pose: { position: [100, 0, 0], rotation: [0, 0, 0, 1] },
      scale: 2,
      children: [block('a', [1, 0, 0]), inner],
    };
    const children: TourStationChild[] = [block('top', [7, 0, 0]), outer];
    const flat = tourFlatFreeBlocks(children);
    expect(flat.map((f) => [f.block.id, f.scale])).toEqual([
      ['top', 1],
      ['a', 2],
      ['b', 6],
    ]);
    // b: inner puts it at [3, 0, 5]; outer at 100 + 2 * that.
    expect(flat.map((f) => f.block.pose.position)).toEqual([
      [7, 0, 0],
      [102, 0, 0],
      [106, 0, 10],
    ]);
    expect(tourFreeBlocks({ children }).map((b) => b.id)).toEqual([
      'top',
      'a',
      'b',
    ]);
  });

  it('a block outside any folder is handed on as it is', () => {
    const top = block('top', [1, 2, 3]);
    expect(tourFreeBlocks({ children: [top] })[0]).toBe(top);
  });
});
