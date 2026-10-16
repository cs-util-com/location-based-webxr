import type { RecorderColmapModel } from './model.js';
import { ColmapError, validateRecorderColmapModel } from './validate.js';

/** The three required COLMAP text payloads, represented before ZIP concerns. */
export interface ColmapTextFiles {
  readonly cameras: Uint8Array;
  readonly images: Uint8Array;
  readonly points3D: Uint8Array;
}

const paths = {
  cameras: 'sparse/0/cameras.txt',
  images: 'sparse/0/images.txt',
  points3D: 'sparse/0/points3D.txt',
} as const;

const unsignedIntegerToken = /^(?:0|[1-9][0-9]*)$/;
const floatToken = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const encoder = new TextEncoder();

interface DecodedText {
  readonly lines: readonly string[];
  readonly hasFinalLineEnding: boolean;
}

/** Parse the recorder's three supported COLMAP text payloads. */
export function parseRecorderColmapText(
  files: ColmapTextFiles
): RecorderColmapModel {
  const source = {
    cameras: decode(files.cameras, paths.cameras),
    images: decode(files.images, paths.images),
    points3D: decode(files.points3D, paths.points3D),
  };
  const model: RecorderColmapModel = {
    cameras: parseCameras(source.cameras),
    images: parseImages(source.images),
    points3D: parsePoints3D(source.points3D),
  };

  try {
    validateRecorderColmapModel(model);
  } catch (error) {
    rethrowWithSourceLocation(error, source);
  }
  return model;
}

/** Serialize one validated model to the canonical recorder COLMAP text. */
export function serializeRecorderColmapText(
  model: RecorderColmapModel
): ColmapTextFiles {
  validateRecorderColmapModel(model);

  const camera = model.cameras[0]!;
  const cameraLines = [
    '# Camera list with one line of data per camera:',
    '#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]',
    '# Number of cameras: 1',
    [
      camera.cameraId,
      camera.model,
      camera.width,
      camera.height,
      camera.intrinsics.fx,
      camera.intrinsics.fy,
      camera.intrinsics.cx,
      camera.intrinsics.cy,
    ].join(' '),
  ];
  const imageLines = [
    '# Image list with two lines of data per image:',
    '#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME',
    '#   POINTS2D[] as (X, Y, POINT3D_ID)',
    `# Number of images: ${model.images.length}, mean observations per image: 0`,
    ...model.images.flatMap((image) => [
      [
        image.imageId,
        ...image.pose.qvec,
        ...image.pose.tvec,
        image.cameraId,
        image.name,
      ].join(' '),
      '',
    ]),
  ];
  const pointLines = [
    '# 3D point list with one line of data per point:',
    '#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)',
    `# Number of points: ${model.points3D.length}, mean track length: 0`,
    ...model.points3D.map((point) =>
      [point.point3DId, ...point.xyz, ...point.rgb, point.error].join(' ')
    ),
  ];

  return {
    cameras: encodeLines(cameraLines),
    images: encodeLines(imageLines),
    points3D: encodeLines(pointLines),
  };
}

function encodeLines(lines: readonly string[]): Uint8Array {
  return encoder.encode(`${lines.join('\n')}\n`);
}

function rethrowWithSourceLocation(
  error: unknown,
  source: Readonly<Record<keyof ColmapTextFiles, DecodedText>>
): never {
  if (!(error instanceof ColmapError)) {
    throw error;
  }

  const location = /^(cameras|images|points3D)(?:\[(\d+)\])?/.exec(
    error.path ?? ''
  );
  if (location === null) {
    throw error;
  }

  const file = location[1] as keyof ColmapTextFiles;
  const recordIndex =
    location[2] === undefined ? undefined : Number(location[2]);
  const line =
    recordIndex === undefined
      ? undefined
      : firstDataLine(source[file]) + recordIndex * (file === 'images' ? 2 : 1);

  throw new ColmapError(
    error.message,
    {
      kind: error.kind,
      path: paths[file],
      ...(line === undefined ? {} : { line }),
      ...(error.field === undefined ? {} : { field: error.field }),
    },
    { cause: error }
  );
}

function decode(bytes: Uint8Array, path: string): DecodedText {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail('syntax', path, 1, 'encoding', 'UTF-8 BOM is not supported');
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new ColmapError(
      'Invalid UTF-8',
      { kind: 'syntax', path, field: 'encoding' },
      { cause }
    );
  }

  const nul = text.indexOf('\0');
  if (nul !== -1) {
    fail('syntax', path, lineAt(text, nul), 'encoding', 'NUL is not supported');
  }

  const normalized = text.replaceAll('\r\n', '\n');
  const bareCarriageReturn = normalized.indexOf('\r');
  if (bareCarriageReturn !== -1) {
    fail(
      'syntax',
      path,
      lineAt(normalized, bareCarriageReturn),
      'encoding',
      'Bare carriage return is not supported'
    );
  }

  return {
    lines: normalized.split('\n'),
    hasFinalLineEnding: normalized.endsWith('\n'),
  };
}

function parseCameras(text: DecodedText): RecorderColmapModel['cameras'] {
  const cameras: RecorderColmapModel['cameras'][number][] = [];

  for (const [index, line] of dataLines(text).entries()) {
    const lineNumber = index + firstDataLine(text);
    const tokens = splitFields(line, paths.cameras, lineNumber);

    if (tokens[1] !== undefined && tokens[1] !== 'PINHOLE') {
      fail(
        'unsupported-profile',
        paths.cameras,
        lineNumber,
        'model',
        `Camera model ${tokens[1]} is not supported`
      );
    }
    requireArity(tokens, 8, paths.cameras, lineNumber);

    cameras.push({
      cameraId: readUnsigned(tokens[0]!, paths.cameras, lineNumber, 'cameraId'),
      model: 'PINHOLE',
      width: readUnsigned(tokens[2]!, paths.cameras, lineNumber, 'width'),
      height: readUnsigned(tokens[3]!, paths.cameras, lineNumber, 'height'),
      intrinsics: {
        fx: readFloat(tokens[4]!, paths.cameras, lineNumber, 'fx'),
        fy: readFloat(tokens[5]!, paths.cameras, lineNumber, 'fy'),
        cx: readFloat(tokens[6]!, paths.cameras, lineNumber, 'cx'),
        cy: readFloat(tokens[7]!, paths.cameras, lineNumber, 'cy'),
      },
    });
  }

  return cameras;
}

function parseImages(text: DecodedText): RecorderColmapModel['images'] {
  const images: RecorderColmapModel['images'][number][] = [];
  let index = firstDataLine(text) - 1;

  while (index < text.lines.length) {
    const poseLine = text.lines[index]!;
    if (
      index === text.lines.length - 1 &&
      text.hasFinalLineEnding &&
      isBlank(poseLine)
    ) {
      break;
    }

    const lineNumber = index + 1;
    const tokens = recordTokens(poseLine, paths.images, lineNumber, 10);
    const observationLine = text.lines[index + 1];
    if (observationLine === undefined) {
      fail(
        'syntax',
        paths.images,
        lineNumber + 1,
        'observations',
        'Image observation line is required'
      );
    }
    if (!isBlank(observationLine)) {
      fail(
        'unsupported-profile',
        paths.images,
        lineNumber + 1,
        'observations',
        'Image observations are not supported'
      );
    }

    images.push({
      imageId: readUnsigned(tokens[0]!, paths.images, lineNumber, 'imageId'),
      pose: {
        qvec: [
          readFloat(tokens[1]!, paths.images, lineNumber, 'qw'),
          readFloat(tokens[2]!, paths.images, lineNumber, 'qx'),
          readFloat(tokens[3]!, paths.images, lineNumber, 'qy'),
          readFloat(tokens[4]!, paths.images, lineNumber, 'qz'),
        ],
        tvec: [
          readFloat(tokens[5]!, paths.images, lineNumber, 'tx'),
          readFloat(tokens[6]!, paths.images, lineNumber, 'ty'),
          readFloat(tokens[7]!, paths.images, lineNumber, 'tz'),
        ],
      },
      cameraId: readUnsigned(tokens[8]!, paths.images, lineNumber, 'cameraId'),
      name: tokens[9]!,
      observations: [],
    });
    index += 2;
  }

  return images;
}

function parsePoints3D(text: DecodedText): RecorderColmapModel['points3D'] {
  const points3D: RecorderColmapModel['points3D'][number][] = [];

  for (const [index, line] of dataLines(text).entries()) {
    const lineNumber = index + firstDataLine(text);
    const tokens = splitFields(line, paths.points3D, lineNumber);
    if (tokens.length > 8) {
      fail(
        'unsupported-profile',
        paths.points3D,
        lineNumber,
        'track',
        'Point3D tracks are not supported'
      );
    }
    requireArity(tokens, 8, paths.points3D, lineNumber);

    points3D.push({
      point3DId: readUnsigned(
        tokens[0]!,
        paths.points3D,
        lineNumber,
        'point3DId'
      ),
      xyz: [
        readFloat(tokens[1]!, paths.points3D, lineNumber, 'x'),
        readFloat(tokens[2]!, paths.points3D, lineNumber, 'y'),
        readFloat(tokens[3]!, paths.points3D, lineNumber, 'z'),
      ],
      rgb: [
        readUnsigned(tokens[4]!, paths.points3D, lineNumber, 'r'),
        readUnsigned(tokens[5]!, paths.points3D, lineNumber, 'g'),
        readUnsigned(tokens[6]!, paths.points3D, lineNumber, 'b'),
      ],
      error: readFloat(tokens[7]!, paths.points3D, lineNumber, 'error'),
      track: [],
    });
  }

  return points3D;
}

function dataLines(text: DecodedText): readonly string[] {
  const start = firstDataLine(text) - 1;
  const end = text.hasFinalLineEnding
    ? text.lines.length - 1
    : text.lines.length;
  return text.lines.slice(start, end);
}

function firstDataLine(text: DecodedText): number {
  const index = text.lines.findIndex(
    (line) => !isBlank(line) && !/^[ \t]*#/.test(line)
  );
  return (index === -1 ? text.lines.length : index) + 1;
}

function recordTokens(
  line: string,
  path: string,
  lineNumber: number,
  arity: number
): readonly string[] {
  const tokens = splitFields(line, path, lineNumber);
  requireArity(tokens, arity, path, lineNumber);
  return tokens;
}

function splitFields(
  line: string,
  path: string,
  lineNumber: number
): readonly string[] {
  if (isBlank(line) || /^[ \t]*#/.test(line)) {
    fail(
      'syntax',
      path,
      lineNumber,
      'record',
      'Blank lines and comments are only allowed before data'
    );
  }
  return line.replace(/^[ \t]+|[ \t]+$/g, '').split(/[ \t]+/);
}

function requireArity(
  tokens: readonly string[],
  arity: number,
  path: string,
  lineNumber: number
): void {
  if (tokens.length !== arity) {
    fail(
      'syntax',
      path,
      lineNumber,
      'record',
      `Expected ${arity} fields, received ${tokens.length}`
    );
  }
}

function readUnsigned(
  token: string,
  path: string,
  line: number,
  field: string
): number {
  if (!unsignedIntegerToken.test(token)) {
    fail('syntax', path, line, field, `${field} is not an unsigned integer`);
  }
  return Number(token);
}

function readFloat(
  token: string,
  path: string,
  line: number,
  field: string
): number {
  if (!floatToken.test(token)) {
    fail('syntax', path, line, field, `${field} is not a float`);
  }
  return Number(token);
}

function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function fail(
  kind: 'syntax' | 'unsupported-profile',
  path: string,
  line: number,
  field: string,
  message: string
): never {
  throw new ColmapError(message, { kind, path, line, field });
}
