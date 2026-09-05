/**
 * Tests for the COLMAP `sparse/0/` text serializers.
 *
 * Why this test file matters:
 * COLMAP's text format is positional and whitespace-significant; a 3DGS loader
 * silently mis-reads a malformed line rather than erroring. These tests pin the
 * EXACT line shapes (field order, the single shared camera, the mandatory empty
 * keypoint line per image, the empty track per point) so a format regression is
 * caught here, not on-device. They also lock in the deliberate design choices
 * from the plan (Q1 empty tracks, Q3 voxel RGB).
 */

import { describe, it, expect } from 'vitest';
import {
  serializeCamerasTxt,
  serializeImagesTxt,
  serializePoints3DTxt,
} from './colmap-serializers';
import { webxrToColmapPose } from './colmap-conversions';

describe('serializeCamerasTxt', () => {
  it('emits a single PINHOLE camera line with fx fy cx cy params', () => {
    const txt = serializeCamerasTxt(
      1280,
      960,
      { fx: 1000, fy: 1100, cx: 640, cy: 480 },
      1
    );
    const dataLines = txt
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.startsWith('#'));
    expect(dataLines).toEqual(['1 PINHOLE 1280 960 1000 1100 640 480']);
  });

  it('includes the standard COLMAP comment header and camera count', () => {
    const txt = serializeCamerasTxt(640, 480, {
      fx: 500,
      fy: 500,
      cx: 320,
      cy: 240,
    });
    expect(txt).toContain('# Camera list with one line of data per camera:');
    expect(txt).toContain('# Number of cameras: 1');
  });
});

describe('serializeImagesTxt', () => {
  const pose = webxrToColmapPose([0, 0, 0], [0, 0, 0, 1]);

  it('emits two lines per image: pose line then an EMPTY keypoint line', () => {
    const txt = serializeImagesTxt(
      [
        { imageId: 1, pose, name: 'frame-000001.jpg' },
        { imageId: 2, pose, name: 'frame-000002.jpg' },
      ],
      1
    );
    const lines = txt.split('\n');
    const headerCount = lines.filter((l) => l.startsWith('#')).length;
    const body = lines.slice(headerCount);
    // image 1: pose line + empty line; image 2: pose line + empty line
    expect(body[0]).toMatch(
      /^1 \S+ \S+ \S+ \S+ \S+ \S+ \S+ 1 frame-000001\.jpg$/
    );
    expect(body[1]).toBe('');
    expect(body[2]).toMatch(
      /^2 \S+ \S+ \S+ \S+ \S+ \S+ \S+ 1 frame-000002\.jpg$/
    );
    expect(body[3]).toBe('');
  });

  it('writes qvec in COLMAP order [qw qx qy qz] then tvec', () => {
    const txt = serializeImagesTxt(
      [{ imageId: 7, pose, name: 'frame-000007.jpg' }],
      3
    );
    const poseLine = txt
      .split('\n')
      .find((l) => l.startsWith('7 '))!
      .split(' ');
    // 7 QW QX QY QZ TX TY TZ CAMERA_ID NAME
    expect(poseLine[0]).toBe('7');
    expect(Number(poseLine[1])).toBeCloseTo(pose.qvec[0], 6); // qw
    expect(Number(poseLine[2])).toBeCloseTo(pose.qvec[1], 6); // qx
    expect(Number(poseLine[5])).toBeCloseTo(pose.tvec[0], 6); // tx
    expect(poseLine[8]).toBe('3'); // CAMERA_ID
    expect(poseLine[9]).toBe('frame-000007.jpg');
  });

  it('reports mean observations per image as 0 (no tracks)', () => {
    const txt = serializeImagesTxt([{ imageId: 1, pose, name: 'f.jpg' }]);
    expect(txt).toContain(
      '# Number of images: 1, mean observations per image: 0'
    );
  });
});

describe('serializePoints3DTxt', () => {
  it('emits one line per point: id X Y Z R G B ERROR with an EMPTY track', () => {
    const txt = serializePoints3DTxt([
      { pointId: 1, xyz: [1.5, -2, 3], rgb: [10, 20, 30], error: 1 },
      { pointId: 2, xyz: [0, 0, 0], rgb: [255, 255, 255], error: 1 },
    ]);
    const body = txt
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.startsWith('#'));
    expect(body[0]).toBe('1 1.5 -2 3 10 20 30 1');
    expect(body[1]).toBe('2 0 0 0 255 255 255 1');
  });

  it('rounds and clamps RGB to integer 0–255', () => {
    const txt = serializePoints3DTxt([
      { pointId: 1, xyz: [0, 0, 0], rgb: [300, -5, 127.6], error: 1 },
    ]);
    const body = txt.split('\n').find((l) => l.startsWith('1 '))!;
    expect(body).toBe('1 0 0 0 255 0 128 1');
  });

  it('writes 0 for a non-finite colour channel instead of the literal NaN', () => {
    // Why this test matters: Math.round(NaN) is NaN and Math.min/Math.max
    // propagate it, so a NaN channel used to reach points3D.txt as the text
    // "NaN" - which no COLMAP reader parses as a byte, corrupting the file
    // for every downstream tool. The header promises an integer 0-255.
    const txt = serializePoints3DTxt([
      { pointId: 1, xyz: [0, 0, 0], rgb: [NaN, Infinity, -Infinity], error: 1 },
    ]);
    const body = txt.split('\n').find((l) => l.startsWith('1 '))!;
    expect(body).toBe('1 0 0 0 0 255 0 1');
  });

  it('reports point count and mean track length 0', () => {
    const txt = serializePoints3DTxt([
      { pointId: 1, xyz: [0, 0, 0], rgb: [1, 2, 3], error: 1 },
    ]);
    expect(txt).toContain('# Number of points: 1, mean track length: 0');
  });

  it('handles an empty point set (header only, count 0)', () => {
    const txt = serializePoints3DTxt([]);
    expect(txt).toContain('# Number of points: 0, mean track length: 0');
    expect(
      txt.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'))
    ).toEqual([]);
  });
});
