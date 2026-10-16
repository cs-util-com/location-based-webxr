import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import { describe, expect, test } from 'vitest';

import type { ColmapImage } from './model.js';
import {
  recorderZipAdapter,
  type ArchiveEntry,
  type SparseTextPath,
} from './recorder-zip-adapter.js';
import { ColmapError } from './validate.js';

const encoder = new TextEncoder();
const sparseTextPaths = [
  'sparse/0/cameras.txt',
  'sparse/0/images.txt',
  'sparse/0/points3D.txt',
] as const satisfies readonly SparseTextPath[];
const forbiddenBinaryPaths = [
  'sparse/0/cameras.bin',
  'sparse/0/images.bin',
  'sparse/0/points3D.bin',
] as const;

const validEntries: readonly ArchiveEntry[] = [
  directory('sparse/'),
  directory('sparse/0/'),
  directory('images/'),
  directory('actions/'),
  directory('unknown/'),
  file('sparse/0/cameras.txt', 'camera text'),
  file('sparse/0/images.txt', 'image text'),
  file('sparse/0/points3D.txt', ''),
  file('images/frame-000001.jpg', new Uint8Array([255, 216, 1, 255, 217])),
  file('images/frame-000002.jpg', new Uint8Array([255, 216, 2, 255, 217])),
  file('images/unreferenced.jpg', new Uint8Array([255, 216, 3, 255, 217])),
  file('actions/example.json', '{"action":"example"}'),
  file('session.json', '{"session":"synthetic"}'),
  file('unknown/empty.bin', new Uint8Array()),
  file('unknown/data.bin', new Uint8Array([0, 255, 1, 128])),
];

describe('recorderZipAdapter.open', () => {
  test('opens the complete synthetic inventory and exposes the three text files', async () => {
    const archive = await recorderZipAdapter.open(await buildZip(validEntries));

    expect(archive.entries).toEqual(validEntries);
    for (const path of sparseTextPaths) {
      expect(archive.colmapText[path]).toEqual(
        validEntries.find((entry) => entry.path === path)?.bytes
      );
    }
  });

  test.each(sparseTextPaths)('rejects a model missing %s', async (path) => {
    const error = await openFailure(
      validEntries.filter((entry) => entry.path !== path)
    );

    expect(error).toMatchObject({ kind: 'archive', path });
  });

  test.each(forbiddenBinaryPaths)(
    'rejects binary coexistence at %s',
    async (path) => {
      const error = await openFailure([...validEntries, file(path, 'binary')]);

      expect(error).toMatchObject({ kind: 'archive', path });
    }
  );

  test.each([
    '/absolute.jpg',
    'C:/drive.jpg',
    'images\\backslash.jpg',
    'images/\u0001control.jpg',
    'images//repeated.jpg',
    'images/./dot.jpg',
    'images/../parent.jpg',
  ])('rejects the unsafe stored path %s', async (path) => {
    const zipBytes = await buildZipWithPatchedFilePath(path);
    const error = await caught(recorderZipAdapter.open(zipBytes));

    expect(error).toMatchObject({ kind: 'archive', path });
  });

  test('rejects a file path with a directory suffix', async () => {
    const path = 'bad/';
    const zipBytes = replaceStoredPath(
      await buildZip([...validEntries, file('xxxx', 'bad')]),
      'xxxx',
      path
    );

    const error = await caught(recorderZipAdapter.open(zipBytes));
    expect(error).toMatchObject({ kind: 'archive', path });
  });

  test('rejects a directory path without its required suffix', async () => {
    const path = 'badxx';
    const zipBytes = replaceStoredPath(
      await buildZip([...validEntries, directory('xxxx/')]),
      'xxxx/',
      path
    );

    const error = await caught(recorderZipAdapter.open(zipBytes));
    expect(error).toMatchObject({ kind: 'archive', path });
  });

  test('rejects exact duplicate paths', async () => {
    const path = 'duplicate-a';
    const zipBytes = replaceStoredPath(
      await buildZip([
        ...validEntries,
        file(path, 'first'),
        file('duplicate-b', 'second'),
      ]),
      'duplicate-b',
      path
    );

    const error = await caught(recorderZipAdapter.open(zipBytes));
    expect(error).toMatchObject({ kind: 'archive', path });
  });

  test('rejects ASCII-case path collisions', async () => {
    const path = 'images/case.jpg';
    const error = await openFailure([
      ...validEntries,
      file('images/Case.jpg', 'first'),
      file(path, 'second'),
    ]);

    expect(error).toMatchObject({ kind: 'archive', path });
  });

  test('wraps malformed ZIP input in the shared error', async () => {
    const error = await caught(
      recorderZipAdapter.open(new Uint8Array([1, 2, 3]))
    );

    expect(error).toMatchObject({ kind: 'archive' });
    expect(error.cause).toBeDefined();
  });

  test('rejects an entry whose payload no longer matches its ZIP checksum', async () => {
    const cameras = '1 PINHOLE 640 480 500 500 320 240\n';
    const entries = validEntries.map((entry) =>
      entry.path === 'sparse/0/cameras.txt' ? file(entry.path, cameras) : entry
    );
    const corrupted = replaceStoredPayload(
      await buildZip(entries, 0),
      ' 500 500 ',
      ' 900 500 '
    );

    const error = await caught(recorderZipAdapter.open(corrupted));

    expect(error).toMatchObject({
      kind: 'archive',
      path: 'sparse/0/cameras.txt',
    });
  });
});

describe('recorderZipAdapter.resolveImages', () => {
  test('resolves exact case-sensitive paths in model order', async () => {
    const archive = await recorderZipAdapter.open(await buildZip(validEntries));

    const resolved = recorderZipAdapter.resolveImages(archive, [
      image(2, 'frame-000002.jpg'),
      image(1, 'frame-000001.jpg'),
    ]);

    expect(resolved.map((entry) => entry.path)).toEqual([
      'images/frame-000002.jpg',
      'images/frame-000001.jpg',
    ]);
  });

  test('reports the image ID and exact expected path when an image is missing', async () => {
    const archive = await recorderZipAdapter.open(await buildZip(validEntries));
    const missingImage = image(17, 'Frame-000001.jpg');

    const error = caughtSync(() =>
      recorderZipAdapter.resolveImages(archive, [missingImage])
    );

    expect(error).toMatchObject({
      kind: 'reference',
      path: 'images/Frame-000001.jpg',
      field: 'name',
    });
    expect(error.message).toContain('17');
  });
});

describe('recorderZipAdapter.copyWithReplacements', () => {
  test('replaces only the three sparse texts and preserves every other entry', async () => {
    const before = await recorderZipAdapter.open(await buildZip(validEntries));
    const replacements: Record<SparseTextPath, Uint8Array> = {
      'sparse/0/cameras.txt': encoder.encode('new cameras'),
      'sparse/0/images.txt': encoder.encode('new images'),
      'sparse/0/points3D.txt': encoder.encode('new points'),
    };

    const output = await recorderZipAdapter.copyWithReplacements(
      before,
      replacements
    );
    const after = await recorderZipAdapter.open(output);
    const beforeByPath = new Map(
      before.entries.map((entry) => [entry.path, entry])
    );
    const afterByPath = new Map(
      after.entries.map((entry) => [entry.path, entry])
    );

    expect(new Set(afterByPath.keys())).toEqual(new Set(beforeByPath.keys()));
    for (const [path, original] of beforeByPath) {
      const copied = afterByPath.get(path)!;
      expect(copied.kind).toBe(original.kind);
      expect(copied.bytes).toEqual(
        sparseTextPaths.includes(path as SparseTextPath)
          ? replacements[path as SparseTextPath]
          : original.bytes
      );
    }
  });

  test('returns no bytes when reconstruction fails', async () => {
    const archive = await recorderZipAdapter.open(await buildZip(validEntries));
    const duplicate = archive.entries.find(
      (entry) => entry.path === 'session.json'
    )!;
    let output: Uint8Array | undefined;

    const error = await caught(
      recorderZipAdapter
        .copyWithReplacements(
          { ...archive, entries: [...archive.entries, duplicate] },
          {
            'sparse/0/cameras.txt': encoder.encode('new cameras'),
            'sparse/0/images.txt': encoder.encode('new images'),
            'sparse/0/points3D.txt': encoder.encode('new points'),
          }
        )
        .then((bytes) => {
          output = bytes;
        })
    );

    expect(error).toMatchObject({ kind: 'archive', path: 'session.json' });
    expect(output).toBeUndefined();
  });
});

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

function image(imageId: number, name: string): ColmapImage {
  return {
    imageId,
    cameraId: 1,
    name,
    pose: { qvec: [1, 0, 0, 0], tvec: [0, 0, 0] },
    observations: [],
  };
}

async function buildZip(
  entries: readonly ArchiveEntry[],
  level?: 0
): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const entry of entries) {
    if (entry.kind === 'directory') {
      await writer.add(entry.path, undefined, { directory: true });
    } else {
      await writer.add(entry.path, new Uint8ArrayReader(entry.bytes), {
        level,
      });
    }
  }
  return writer.close();
}

function replaceStoredPayload(
  zipBytes: Uint8Array,
  sourceText: string,
  replacementText: string
): Uint8Array {
  const source = encoder.encode(sourceText);
  const replacement = encoder.encode(replacementText);
  expect(replacement).toHaveLength(source.length);
  const index = zipBytes.findIndex((_, start) =>
    source.every((byte, offset) => zipBytes[start + offset] === byte)
  );
  expect(index).toBeGreaterThanOrEqual(0);
  const patched = zipBytes.slice();
  patched.set(replacement, index);
  return patched;
}

async function buildZipWithPatchedFilePath(path: string): Promise<Uint8Array> {
  const safePath = 'x'.repeat(encoder.encode(path).length);
  return replaceStoredPath(
    await buildZip([...validEntries, file(safePath, 'unsafe')]),
    safePath,
    path
  );
}

function replaceStoredPath(
  zipBytes: Uint8Array,
  sourcePath: string,
  replacementPath: string
): Uint8Array {
  const source = encoder.encode(sourcePath);
  const replacement = encoder.encode(replacementPath);
  expect(replacement).toHaveLength(source.length);

  const patched = zipBytes.slice();
  let replacementCount = 0;
  for (let index = 0; index <= patched.length - source.length; index += 1) {
    if (source.every((byte, offset) => patched[index + offset] === byte)) {
      patched.set(replacement, index);
      replacementCount += 1;
      index += source.length - 1;
    }
  }
  expect(replacementCount).toBe(2);
  return patched;
}

async function openFailure(
  entries: readonly ArchiveEntry[]
): Promise<ColmapError> {
  return caught(recorderZipAdapter.open(await buildZip(entries)));
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
