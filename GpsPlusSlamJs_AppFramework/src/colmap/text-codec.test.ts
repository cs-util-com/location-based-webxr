import { describe, expect, it } from 'vitest';

import {
  parseRecorderColmapText,
  serializeRecorderColmapText,
  type ColmapTextFiles,
} from './text-codec.js';
import { exactlyPreserved, semanticallyEqual } from './model-comparison.js';
import { ColmapError } from './validate.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const cameraText = `# camera header
5 PINHOLE 823 1920 1254.3877251148224 1254.169921875 411.5 960
`;
const imageText = `# image header
9 0.7071067811865476 0 0.7071067811865476 0 1 -2 3 5 frame-9.jpg

2 1 0 0 0 -4 5 -6 5 frame-2.jpg

`;
const pointText = `# point header
12 1.5 -2 3e-1 0 128 255 0.25
4 -0 2 1E+3 1 2 3 0
`;

const canonicalCameraText = `# Camera list with one line of data per camera:
#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]
# Number of cameras: 1
5 PINHOLE 823 1920 1254.3877251148224 1254.169921875 411.5 960
`;
const canonicalImageText = `# Image list with two lines of data per image:
#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME
#   POINTS2D[] as (X, Y, POINT3D_ID)
# Number of images: 2, mean observations per image: 0
9 0.7071067811865476 0 0.7071067811865476 0 1 -2 3 5 frame-9.jpg

2 1 0 0 0 -4 5 -6 5 frame-2.jpg

`;
const canonicalPointText = `# 3D point list with one line of data per point:
#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)
# Number of points: 2, mean track length: 0
12 1.5 -2 0.3 0 128 255 0.25
4 0 2 1000 1 2 3 0
`;

function files(
  overrides: Partial<Record<keyof ColmapTextFiles, string | Uint8Array>> = {}
): ColmapTextFiles {
  const value = (key: keyof ColmapTextFiles, fallback: string): Uint8Array => {
    const override = overrides[key] ?? fallback;
    return typeof override === 'string' ? encoder.encode(override) : override;
  };

  return {
    cameras: value('cameras', cameraText),
    images: value('images', imageText),
    points3D: value('points3D', pointText),
  };
}

function expectFailure(
  input: ColmapTextFiles,
  expected: Pick<ColmapError, 'kind' | 'path' | 'line' | 'field'>
): ColmapError {
  try {
    parseRecorderColmapText(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ColmapError);
    expect(error).toMatchObject(expected);
    return error as ColmapError;
  }

  throw new Error('Expected COLMAP parsing to fail');
}

describe('parseRecorderColmapText', () => {
  it('parses ordered sparse records without changing a non-identity pose', () => {
    const model = parseRecorderColmapText(files());

    expect(model.cameras).toEqual([
      {
        cameraId: 5,
        model: 'PINHOLE',
        width: 823,
        height: 1920,
        intrinsics: {
          fx: 1254.3877251148224,
          fy: 1254.169921875,
          cx: 411.5,
          cy: 960,
        },
      },
    ]);
    expect(model.images.map(({ imageId }) => imageId)).toEqual([9, 2]);
    expect(model.images[0]).toMatchObject({
      cameraId: 5,
      name: 'frame-9.jpg',
      pose: {
        qvec: [0.7071067811865476, 0, 0.7071067811865476, 0],
        tvec: [1, -2, 3],
      },
      observations: [],
    });
    expect(model.points3D.map(({ point3DId }) => point3DId)).toEqual([12, 4]);
    expect(model.points3D[1]).toMatchObject({
      xyz: [-0, 2, 1000],
      track: [],
    });
  });

  it('accepts CRLF, leading comments, and optional final line endings', () => {
    const crlf = (text: string): string => text.replaceAll('\n', '\r\n');
    const model = parseRecorderColmapText(
      files({
        cameras: crlf(cameraText).slice(0, -2),
        images: crlf(imageText).slice(0, -2),
        points3D: crlf(pointText).slice(0, -2),
      })
    );

    expect(model.images).toHaveLength(2);
    expect(model.points3D).toHaveLength(2);
  });

  it('accepts an empty points3D body', () => {
    const model = parseRecorderColmapText(
      files({ points3D: '# no points in this recorder model\n' })
    );

    expect(model.points3D).toEqual([]);
  });

  it.each([
    ['BOM', new Uint8Array([0xef, 0xbb, 0xbf, 0x31]), 1],
    ['invalid UTF-8', new Uint8Array([0xc3, 0x28]), undefined],
    ['NUL', encoder.encode('# header\n1\0 PINHOLE'), 2],
    ['bare carriage return', encoder.encode('# header\n1\rPINHOLE'), 2],
  ])('rejects %s during strict decoding', (_name, cameras, line) => {
    expect.hasAssertions();
    expectFailure(files({ cameras }), {
      kind: 'syntax',
      path: 'sparse/0/cameras.txt',
      line,
      field: 'encoding',
    });
  });

  it.each(['+1', '.5', '1.', '01', '0x1', 'NaN', 'Infinity'])(
    'rejects invalid float token %s',
    (token) => {
      expect.hasAssertions();
      expectFailure(files({ cameras: `5 PINHOLE 823 1920 ${token} 1 1 1\n` }), {
        kind: 'syntax',
        path: 'sparse/0/cameras.txt',
        line: 1,
        field: 'fx',
      });
    }
  );

  it.each(['-1', '+1', '01', '0x1'])(
    'rejects invalid unsigned integer token %s',
    (token) => {
      expect.hasAssertions();
      expectFailure(files({ cameras: `${token} PINHOLE 823 1920 1 1 1 1\n` }), {
        kind: 'syntax',
        path: 'sparse/0/cameras.txt',
        line: 1,
        field: 'cameraId',
      });
    }
  );

  it('rejects malformed record arity', () => {
    expect.hasAssertions();
    expectFailure(files({ cameras: '5 PINHOLE 823 1920 1 1 1\n' }), {
      kind: 'syntax',
      path: 'sparse/0/cameras.txt',
      line: 1,
      field: 'record',
    });
  });

  it('rejects comments after data begins', () => {
    expect.hasAssertions();
    expectFailure(files({ points3D: '12 1 2 3 0 0 0 0\n# late comment\n' }), {
      kind: 'syntax',
      path: 'sparse/0/points3D.txt',
      line: 2,
      field: 'record',
    });
  });

  it('requires the physical image observation line', () => {
    expect.hasAssertions();
    expectFailure(files({ images: '9 1 0 0 0 1 2 3 5 frame-9.jpg' }), {
      kind: 'syntax',
      path: 'sparse/0/images.txt',
      line: 2,
      field: 'observations',
    });
  });

  it('rejects populated image observations', () => {
    expect.hasAssertions();
    expectFailure(
      files({ images: '9 1 0 0 0 1 2 3 5 frame-9.jpg\n1 2 -1\n' }),
      {
        kind: 'unsupported-profile',
        path: 'sparse/0/images.txt',
        line: 2,
        field: 'observations',
      }
    );
  });

  it('rejects point tracks', () => {
    expect.hasAssertions();
    expectFailure(files({ points3D: '12 1 2 3 0 0 0 0 9 1\n' }), {
      kind: 'unsupported-profile',
      path: 'sparse/0/points3D.txt',
      line: 1,
      field: 'track',
    });
  });

  it('rejects unsupported camera models', () => {
    expect.hasAssertions();
    expectFailure(files({ cameras: '5 OPENCV 823 1920 1 1 1 1 0 0 0 0\n' }), {
      kind: 'unsupported-profile',
      path: 'sparse/0/cameras.txt',
      line: 1,
      field: 'model',
    });
  });

  it('validates the assembled model before returning it', () => {
    expect.hasAssertions();
    expectFailure(files({ images: '9 2 0 0 0 1 2 3 5 frame-9.jpg\n' }), {
      kind: 'validation',
      path: 'sparse/0/images.txt',
      line: 1,
      field: 'pose.qvec',
    });
  });

  it('reports the missing camera and affected image with source context', () => {
    const error = expectFailure(
      files({ images: '9 1 0 0 0 1 2 3 6 frame-9.jpg\n' }),
      {
        kind: 'reference',
        path: 'sparse/0/images.txt',
        line: 1,
        field: 'cameraId',
      }
    );

    expect(error.message).toContain('Image 9');
    expect(error.message).toContain('camera 6');
  });
});

describe('serializeRecorderColmapText', () => {
  it('emits the exact canonical text for all three files', () => {
    const output = serializeRecorderColmapText(
      parseRecorderColmapText(files())
    );

    expect(decoder.decode(output.cameras)).toBe(canonicalCameraText);
    expect(decoder.decode(output.images)).toBe(canonicalImageText);
    expect(decoder.decode(output.points3D)).toBe(canonicalPointText);
  });

  it('emits only the canonical headers for an empty points file', () => {
    const model = parseRecorderColmapText(
      files({ points3D: '# no points in this recorder model\n' })
    );

    expect(decoder.decode(serializeRecorderColmapText(model).points3D)).toBe(
      `# 3D point list with one line of data per point:\n#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)\n# Number of points: 0, mean track length: 0\n`
    );
  });

  it('is deterministic and canonicalizes valid noncanonical input', () => {
    const before = parseRecorderColmapText(files());
    const first = serializeRecorderColmapText(before);
    const second = serializeRecorderColmapText(before);

    expect(first).toEqual(second);
    expect(decoder.decode(first.cameras)).not.toBe(cameraText);
    expect(decoder.decode(first.points3D)).not.toBe(pointText);

    const after = parseRecorderColmapText(first);
    expect(semanticallyEqual(before, after)).toEqual({ equal: true });
    expect(exactlyPreserved(before, after)).toEqual({ equal: true });
  });

  it('validates the complete model before writing', () => {
    const model = parseRecorderColmapText(files());
    const invalid = {
      ...model,
      points3D: [
        { ...model.points3D[0]!, rgb: [256, 0, 0] as const },
        ...model.points3D.slice(1),
      ],
    };

    expect(() => serializeRecorderColmapText(invalid)).toThrow(ColmapError);
  });
});
