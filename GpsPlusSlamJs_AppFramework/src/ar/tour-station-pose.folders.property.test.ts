/**
 * Why this test matters: a block inside a plain folder has its pose in the
 * folder's frame, and the world view composes the folder's pose in
 * (`tourFreeBlocks`). An editor that moves such a block must turn the
 * world pose back into the folder's frame, so composing then decomposing
 * has to return the block's own pose - otherwise every save would drift it.
 * The tolerances are declared and the offsets swept from a centimetre to
 * the format's 10 km bound, and a folder's scale over its bounds (a tenth
 * to ten times): decomposing divides by it. A folder with no pose and no
 * scale must change nothing at all, bit for bit: most folders will be
 * that. Two nested
 * folders whose turns do not commute are checked against a result worked
 * out by hand, an oracle independent of the code: composing in the wrong
 * order gives another answer.
 */

// Activates the core library's licence before any module under test loads.
import '../test-setup';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Quaternion } from 'gps-plus-slam-js';

import type { TourBlock } from './tour-blocks';
import {
  composedTourFolderScale,
  composeTourFolderPath,
  composeTourFolderPose,
  decomposeTourFolderPath,
  decomposeTourFolderPose,
} from './tour-folder-pose';
import type { TourLocalPose } from './tour-items';
import {
  tourFreeBlocks,
  tourFreeEntries,
  tourObjectBlock,
  tourObjects,
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

  // An editor writes an item back into its folder through every folder
  // holding it: the path's round trip must return the item's own pose,
  // at every depth the format allows, or each save would drift it.
  for (const reach of REACHES) {
    it(`compose then decompose a path of up to three folders returns the pose (offsets up to ${String(reach)} m)`, () => {
      fc.assert(
        fc.property(
          fc.array(poseArbitrary(reach), { minLength: 1, maxLength: 3 }),
          poseArbitrary(reach),
          (folderPoses, pose) => {
            const folders = folderPoses.map((p) => ({ pose: p }));
            const back = decomposeTourFolderPath(
              folders,
              composeTourFolderPath(folders, pose)
            );
            // Each level adds its own rounding: the bound grows with depth.
            expect(positionGap(back, pose)).toBeLessThanOrEqual(
              POSITION_TOLERANCE_M * folders.length
            );
            expect(
              rotationGap(back.rotation, pose.rotation)
            ).toBeLessThanOrEqual(ROTATION_TOLERANCE * folders.length);
          }
        ),
        { numRuns: 200 }
      );
    });
  }

  // Swept: the scale at both bounds and between, and drawn over them.
  const SCALES = [0.1, 0.5, 2, 10];
  const scaleArbitrary = fc.double({ min: 0.1, max: 10, noNaN: true });
  for (const reach of REACHES) {
    it(`compose then decompose a path of scaled folders returns the pose (offsets up to ${String(reach)} m)`, () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              pose: poseArbitrary(reach),
              scale: fc.oneof(fc.constantFrom(...SCALES), scaleArbitrary),
            }),
            { minLength: 1, maxLength: 3 }
          ),
          poseArbitrary(reach),
          (folders, pose) => {
            const back = decomposeTourFolderPath(
              folders,
              composeTourFolderPath(folders, pose)
            );
            expect(positionGap(back, pose)).toBeLessThanOrEqual(
              POSITION_TOLERANCE_M * folders.length
            );
            expect(
              rotationGap(back.rotation, pose.rotation)
            ).toBeLessThanOrEqual(ROTATION_TOLERANCE * folders.length);
          }
        ),
        { numRuns: 200 }
      );
    });
  }

  it('a scale with no pose scales the offset alone, and decomposes back', () => {
    for (const scale of SCALES) {
      const pose: TourLocalPose = {
        position: [1, -2, 3],
        rotation: QUARTER_ABOUT_UP,
      };
      const out = composeTourFolderPose({ scale }, pose);
      expect(out.position).toEqual([scale, -2 * scale, 3 * scale]);
      expect(out.rotation).toBe(pose.rotation);
      const back = decomposeTourFolderPose({ scale }, out);
      expect(positionGap(back, pose)).toBeLessThanOrEqual(1e-12);
    }
  });

  it('a scaled, turned folder puts its child where worked out by hand', () => {
    // R_up(90) [1, 0, 0] = [0, 0, -1]; scaled by 2, then moved 10 north:
    // [10, 0, -2]. Scaling after moving would give [20, 0, -2].
    const out = composeTourFolderPose(
      {
        pose: { position: [10, 0, 0], rotation: QUARTER_ABOUT_UP },
        scale: 2,
      },
      { position: [1, 0, 0], rotation: IDENTITY }
    );
    expect(out.position[0]).toBeCloseTo(10, 12);
    expect(out.position[1]).toBeCloseTo(0, 12);
    expect(out.position[2]).toBeCloseTo(-2, 12);
    expect(rotationGap(out.rotation, QUARTER_ABOUT_UP)).toBeLessThan(1e-15);
  });

  it('the composed scale is the product along the path, 1 for none', () => {
    expect(composedTourFolderScale([])).toBe(1);
    expect(composedTourFolderScale([{}, { scale: 1 }])).toBe(1);
    expect(composedTourFolderScale([{ scale: 2 }, {}, { scale: 3 }])).toBe(6);
    expect(composedTourFolderScale([{ scale: 0.5 }, { scale: 2 }])).toBe(1);
  });

  it('no pose is the identity, bit for bit, and so is an empty path', () => {
    fc.assert(
      fc.property(poseArbitrary(10_000), (pose) => {
        expect(composeTourFolderPose({}, pose)).toBe(pose);
        expect(decomposeTourFolderPose({}, pose)).toBe(pose);
        expect(composeTourFolderPose({ scale: 1 }, pose)).toBe(pose);
        expect(decomposeTourFolderPose({ scale: 1 }, pose)).toBe(pose);
        expect(composeTourFolderPath([], pose)).toBe(pose);
        expect(composeTourFolderPath([{}, {}], pose)).toBe(pose);
        expect(decomposeTourFolderPath([], pose)).toBe(pose);
        expect(decomposeTourFolderPath([{}, {}], pose)).toBe(pose);
      })
    );
  });
});

describe('the world view names the folders holding a block', () => {
  // Why: the editor holds a folder's items as world objects and writes
  // each back into its folder; the object must say which folders hold it,
  // or a save would lose the grouping. The block written back must not
  // carry that name: the file says it by nesting.
  const at = (id: string, position: [number, number, number]): TourBlock => ({
    id,
    kind: 'shortText',
    view: 'pin',
    caption: id,
    pose: { position, rotation: [0, 0, 0, 1] },
  });
  const station = {
    id: 'st',
    geo: { lat: 48, lon: 11, alt: 500, rotation: [0, 0, 0, 1] as Quaternion },
    children: [
      at('top', [1, 0, 0]),
      {
        id: 'outer',
        kind: 'folder' as const,
        pose: {
          position: [5, 0, 0] as [number, number, number],
          rotation: [0, 0, 0, 1] as Quaternion,
        },
        children: [
          at('a', [1, 0, 0]),
          {
            id: 'inner',
            kind: 'folder' as const,
            children: [at('b', [0, 0, 1])],
          },
        ],
      },
    ],
  };

  it('gives each free block its folders, outermost first, and none at the top', () => {
    expect(tourFreeEntries(station).map((e) => [e.block.id, e.folder])).toEqual(
      [
        ['top', []],
        ['a', ['outer']],
        ['b', ['outer', 'inner']],
      ]
    );
    const objects = tourObjects({ stations: [station as never], assets: [] });
    expect(objects.map((o) => [o.id, o.folder])).toEqual([
      ['top', undefined],
      ['a', ['outer']],
      ['b', ['outer', 'inner']],
    ]);
    expect('folder' in (objects[0] ?? {})).toBe(false);
  });

  it('writes the block back without its folders, its station or its geo pose', () => {
    const [, a] = tourObjects({ stations: [station as never], assets: [] });
    if (a === undefined) throw new Error('no object');
    const pose = {
      position: [1, 0, 0] as [number, number, number],
      rotation: IDENTITY,
    };
    expect(tourObjectBlock(a, pose)).toEqual(at('a', [1, 0, 0]));
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

  // Why: a renderer draws each block of a scaled folder that much larger,
  // and only the flattening knows every folder holding it.
  it("gives each free block the product of its folders' scales, and scales its offset", () => {
    const inner: TourFolder = {
      id: 'inner',
      kind: 'folder',
      scale: 3,
      children: [block('b', [1, 0, 0])],
    };
    const outer: TourFolder = {
      id: 'outer',
      kind: 'folder',
      pose: { position: [100, 0, 0], rotation: IDENTITY },
      scale: 2,
      children: [block('a', [1, 0, 0]), inner],
    };
    const entries = tourFreeEntries({
      children: [block('top', [7, 0, 0]), outer],
    });
    expect(entries.map((e) => [e.block.id, e.scale])).toEqual([
      ['top', 1],
      ['a', 2],
      ['b', 6],
    ]);
    // b: 3 x [1, 0, 0] in the inner folder, 2 x that plus 100 north.
    expect(entries.map((e) => e.block.pose.position)).toEqual([
      [7, 0, 0],
      [102, 0, 0],
      [106, 0, 0],
    ]);
  });

  it('a block outside any folder is handed on as it is', () => {
    const top = block('top', [1, 2, 3]);
    expect(tourFreeBlocks({ children: [top] })[0]).toBe(top);
  });
});
