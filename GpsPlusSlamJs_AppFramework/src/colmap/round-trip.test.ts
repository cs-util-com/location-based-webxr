import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import { describe, expect, test } from 'vitest';

import * as colmap from './index.js';
import type { RecorderColmapModel } from './model.js';
import {
  recorderZipAdapter,
  type ArchiveEntry,
  type OpenedRecorderArchive,
  type SparseTextPath,
} from './recorder-zip-adapter.js';
import { serializeRecorderColmapText } from './text-codec.js';
import { ColmapError } from './validate.js';

const encoder = new TextEncoder();
const sparseTextPaths = [
  'sparse/0/cameras.txt',
  'sparse/0/images.txt',
  'sparse/0/points3D.txt',
] as const satisfies readonly SparseTextPath[];

const expectedModel: RecorderColmapModel = {
  cameras: [
    {
      cameraId: 3,
      model: 'PINHOLE',
      width: 1920,
      height: 1080,
      intrinsics: { fx: 1000, fy: 1001, cx: 960, cy: 540 },
    },
  ],
  images: [
    {
      imageId: 8,
      cameraId: 3,
      name: 'frame-8.jpg',
      pose: { qvec: [1, 0, 0, 0], tvec: [8, 0, 0] },
      observations: [],
    },
    {
      imageId: 1,
      cameraId: 3,
      name: 'frame-1.jpg',
      pose: { qvec: [0.5, 0.5, 0.5, 0.5], tvec: [1, 2, 3] },
      observations: [],
    },
  ],
  points3D: [
    {
      point3DId: 9,
      xyz: [1.25, -2, 3],
      rgb: [12, 34, 56],
      error: 0.5,
      track: [],
    },
  ],
};

const noncanonicalText: Readonly<Record<SparseTextPath, Uint8Array>> = {
  'sparse/0/cameras.txt': encoder.encode(
    '# Number of cameras: 99\r\n  3\tPINHOLE  1920 1080 1000.0 1001.0 960.0 540.0\r\n'
  ),
  'sparse/0/images.txt': encoder.encode(
    '# Number of images: 999\r\n' +
      '8 1.0 0.0 0e0 0.0 8.0 0.0 0.0 3 frame-8.jpg\r\n\r\n' +
      '1 0.5 0.5 0.5 0.5 1.0 2.0 3.0 3 frame-1.jpg\r\n\r\n'
  ),
  'sparse/0/points3D.txt': encoder.encode(
    '# Number of points: 999\r\n9 1.2500 -2.0 3e0 12 34 56 0.500\r\n'
  ),
};

describe('public recorder round trip', () => {
  test('exports the intended runtime API from the source entry', () => {
    expect(Object.keys(colmap).sort()).toEqual(
      [
        'ColmapError',
        'exactlyPreserved',
        'readRecorderZip',
        'roundTripRecorderZip',
        'semanticallyEqual',
        'summarizeRecorderModel',
        'writeRecorderZip',
      ].sort()
    );
  });

  test('reads the typed model and rejects a missing referenced image', async () => {
    const entries = recorderEntries();
    const dataset = await colmap.readRecorderZip(await buildZip(entries));

    expect(dataset.model).toEqual(expectedModel);

    const path = 'images/frame-1.jpg';
    const error = await caught(
      colmap.readRecorderZip(
        await buildZip(entries.filter((entry) => entry.path !== path))
      )
    );
    expect(error).toMatchObject({ kind: 'reference', path, field: 'name' });
    expect(error.message).toContain('1');
  });

  test('summarizes model values and selects image ID 1 explicitly', () => {
    expect(colmap.summarizeRecorderModel(expectedModel)).toEqual({
      imageCount: 2,
      point3DCount: 1,
      camera: expectedModel.cameras[0],
      image1: expectedModel.images[1],
      referencedImageCount: 2,
    });

    const error = caughtSync(() =>
      colmap.summarizeRecorderModel({
        ...expectedModel,
        images: [expectedModel.images[0]!],
      })
    );
    expect(error).toMatchObject({ kind: 'reference', field: 'imageId' });
    expect(error.message).toContain('1');
  });

  test('writes the supplied model canonically and preserves opaque entries', async () => {
    const input = await buildZip(recorderEntries());
    const dataset = await colmap.readRecorderZip(input);
    const editedModel: RecorderColmapModel = {
      ...dataset.model,
      images: dataset.model.images.map((image) =>
        image.imageId === 1
          ? {
              ...image,
              pose: { ...image.pose, tvec: [4, 5, 6] },
            }
          : image
      ),
    };

    const output = await colmap.writeRecorderZip(dataset, editedModel);
    const reopened = await colmap.readRecorderZip(output);
    expect(colmap.semanticallyEqual(editedModel, reopened.model)).toEqual({
      equal: true,
    });

    const before = await recorderZipAdapter.open(input);
    const after = await recorderZipAdapter.open(output);
    const serialized = serializeRecorderColmapText(editedModel);
    const replacements: Readonly<Record<SparseTextPath, Uint8Array>> = {
      'sparse/0/cameras.txt': serialized.cameras,
      'sparse/0/images.txt': serialized.images,
      'sparse/0/points3D.txt': serialized.points3D,
    };

    expectPreservedArchive(before, after, replacements);
    for (const path of sparseTextPaths) {
      expect(after.colmapText[path]).not.toEqual(before.colmapText[path]);
    }
  });

  test('returns no output when the supplied model names a missing asset', async () => {
    const dataset = await colmap.readRecorderZip(
      await buildZip(recorderEntries())
    );
    const missingPath = 'images/missing.jpg';
    const missingAssetModel: RecorderColmapModel = {
      ...dataset.model,
      images: dataset.model.images.map((image, index) =>
        index === 0 ? { ...image, name: 'missing.jpg' } : image
      ),
    };
    let output: Uint8Array | undefined;

    const error = await caught(
      colmap.writeRecorderZip(dataset, missingAssetModel).then((bytes) => {
        output = bytes;
      })
    );

    expect(error).toMatchObject({
      kind: 'reference',
      path: missingPath,
      field: 'name',
    });
    expect(output).toBeUndefined();
  });

  test('round trips the unchanged model with all verification evidence', async () => {
    const result = await colmap.roundTripRecorderZip(
      await buildZip(recorderEntries())
    );

    expect(result.dataset.model).toEqual(expectedModel);
    expect(result.summary.image1.imageId).toBe(1);
    expect(result.verification).toEqual({
      semanticModel: true,
      exactNoOpModel: true,
      untouchedEntries: true,
      replacementPaths: sparseTextPaths,
    });

    const reopened = await colmap.readRecorderZip(result.outputZipBytes);
    expect(colmap.exactlyPreserved(expectedModel, reopened.model)).toEqual({
      equal: true,
    });
  });
});

function recorderEntries(): readonly ArchiveEntry[] {
  return [
    file('session.json', '{"session":"synthetic"}'),
    directory('images/'),
    file('images/unreferenced.jpg', new Uint8Array([255, 216, 3, 255, 217])),
    directory('actions/'),
    file('actions/example.json', '{"action":"keep"}'),
    directory('sparse/'),
    directory('sparse/0/'),
    file('sparse/0/images.txt', noncanonicalText['sparse/0/images.txt']),
    file('images/frame-8.jpg', new Uint8Array([255, 216, 8, 255, 217])),
    file('unknown.bin', new Uint8Array([0, 255, 1, 128])),
    file('sparse/0/cameras.txt', noncanonicalText['sparse/0/cameras.txt']),
    file('images/frame-1.jpg', new Uint8Array([255, 216, 1, 255, 217])),
    file('sparse/0/points3D.txt', noncanonicalText['sparse/0/points3D.txt']),
  ];
}

function directory(path: string): ArchiveEntry {
  return { path, kind: 'directory', bytes: new Uint8Array() };
}

function file(path: string, contents: string | Uint8Array): ArchiveEntry {
  return {
    path,
    kind: 'file',
    bytes: typeof contents === 'string' ? encoder.encode(contents) : contents,
  };
}

async function buildZip(entries: readonly ArchiveEntry[]): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const entry of entries) {
    if (entry.kind === 'directory') {
      await writer.add(entry.path, undefined, { directory: true });
    } else {
      await writer.add(entry.path, new Uint8ArrayReader(entry.bytes));
    }
  }
  return writer.close();
}

function expectPreservedArchive(
  before: OpenedRecorderArchive,
  after: OpenedRecorderArchive,
  replacements: Readonly<Record<SparseTextPath, Uint8Array>>
): void {
  const afterByPath = new Map(
    after.entries.map((entry) => [entry.path, entry])
  );

  expect(after.entries).toHaveLength(before.entries.length);
  for (const original of before.entries) {
    const copied = afterByPath.get(original.path);
    expect(copied?.kind).toBe(original.kind);
    expect(copied?.bytes).toEqual(
      original.kind === 'file' &&
        sparseTextPaths.includes(original.path as SparseTextPath)
        ? replacements[original.path as SparseTextPath]
        : original.bytes
    );
  }
}

async function caught(promise: Promise<unknown>): Promise<ColmapError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ColmapError);
    return error as ColmapError;
  }
  throw new Error('Expected operation to fail');
}

function caughtSync(operation: () => unknown): ColmapError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ColmapError);
    return error as ColmapError;
  }
  throw new Error('Expected operation to fail');
}
