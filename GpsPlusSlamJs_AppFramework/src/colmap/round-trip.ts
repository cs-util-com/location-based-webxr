import type {
  ColmapImage,
  PinholeCamera,
  RecorderColmapModel,
} from './model.js';
import {
  exactlyPreserved,
  semanticallyEqual,
  type ModelComparison,
} from './model-comparison.js';
import {
  recorderZipAdapter,
  type OpenedRecorderArchive,
  type SparseTextPath,
} from './recorder-zip-adapter.js';
import {
  parseRecorderColmapText,
  serializeRecorderColmapText,
  type ColmapTextFiles,
} from './text-codec.js';
import { ColmapError, validateRecorderColmapModel } from './validate.js';

/** Opaque archive state. Only readRecorderZip will create values of this type. */
declare const recorderArchiveSourceBrand: unique symbol;

export interface RecorderArchiveSource {
  readonly [recorderArchiveSourceBrand]: true;
}

export interface RecorderDataset {
  readonly model: RecorderColmapModel;
  /** Passed unchanged to writeRecorderZip so opaque entries survive. */
  readonly sourceArchive: RecorderArchiveSource;
}

export interface DatasetSummary {
  readonly imageCount: number;
  readonly point3DCount: number;
  readonly camera: PinholeCamera;
  readonly image1: ColmapImage;
  readonly referencedImageCount: number;
}

export interface RoundTripVerification {
  readonly semanticModel: true;
  readonly exactNoOpModel: true;
  readonly untouchedEntries: true;
  readonly replacementPaths: readonly [
    'sparse/0/cameras.txt',
    'sparse/0/images.txt',
    'sparse/0/points3D.txt',
  ];
}

export interface RecorderRoundTripResult {
  readonly dataset: RecorderDataset;
  readonly summary: DatasetSummary;
  readonly outputZipBytes: Uint8Array;
  readonly verification: RoundTripVerification;
}

const replacementPaths = [
  'sparse/0/cameras.txt',
  'sparse/0/images.txt',
  'sparse/0/points3D.txt',
] as const satisfies RoundTripVerification['replacementPaths'];

type InternalArchiveSource = RecorderArchiveSource & OpenedRecorderArchive;

export async function readRecorderZip(
  zipBytes: Uint8Array
): Promise<RecorderDataset> {
  const archive = await recorderZipAdapter.open(zipBytes);
  const model = parseRecorderColmapText({
    cameras: archive.colmapText['sparse/0/cameras.txt'],
    images: archive.colmapText['sparse/0/images.txt'],
    points3D: archive.colmapText['sparse/0/points3D.txt'],
  });
  recorderZipAdapter.resolveImages(archive, model.images);

  return { model, sourceArchive: wrapArchive(archive) };
}

export function summarizeRecorderModel(
  model: RecorderColmapModel
): DatasetSummary {
  validateRecorderColmapModel(model);
  const image1 = model.images.find((image) => image.imageId === 1);
  if (image1 === undefined) {
    throw new ColmapError('Required image ID 1 is missing', {
      kind: 'reference',
      path: 'images',
      field: 'imageId',
    });
  }

  return {
    imageCount: model.images.length,
    point3DCount: model.points3D.length,
    camera: model.cameras[0]!,
    image1,
    referencedImageCount: model.images.length,
  };
}

export async function writeRecorderZip(
  source: RecorderDataset,
  model: RecorderColmapModel
): Promise<Uint8Array> {
  validateRecorderColmapModel(model);
  const archive = unwrapArchive(source.sourceArchive);
  recorderZipAdapter.resolveImages(archive, model.images);

  const output = await recorderZipAdapter.copyWithReplacements(
    archive,
    archiveReplacements(serializeRecorderColmapText(model))
  );
  const reopened = await readRecorderZip(output);
  requireEqual(
    semanticallyEqual(model, reopened.model),
    'Written model is not semantically equal'
  );
  return output;
}

export async function roundTripRecorderZip(
  zipBytes: Uint8Array
): Promise<RecorderRoundTripResult> {
  const dataset = await readRecorderZip(zipBytes);
  const summary = summarizeRecorderModel(dataset.model);
  const outputZipBytes = await writeRecorderZip(dataset, dataset.model);
  const reopened = await readRecorderZip(outputZipBytes);

  requireEqual(
    exactlyPreserved(dataset.model, reopened.model),
    'Unchanged model was not exactly preserved'
  );
  requirePreservedArchive(
    unwrapArchive(dataset.sourceArchive),
    unwrapArchive(reopened.sourceArchive),
    archiveReplacements(serializeRecorderColmapText(dataset.model))
  );

  return {
    dataset,
    summary,
    outputZipBytes,
    verification: {
      semanticModel: true,
      exactNoOpModel: true,
      untouchedEntries: true,
      replacementPaths,
    },
  };
}

function archiveReplacements(
  files: ColmapTextFiles
): Readonly<Record<SparseTextPath, Uint8Array>> {
  return {
    'sparse/0/cameras.txt': files.cameras,
    'sparse/0/images.txt': files.images,
    'sparse/0/points3D.txt': files.points3D,
  };
}

function requireEqual(comparison: ModelComparison, message: string): void {
  if (comparison.equal) return;

  throw new ColmapError(`${message}: ${comparison.reason}`, {
    kind: 'validation',
    path: comparison.path,
  });
}

function requirePreservedArchive(
  before: OpenedRecorderArchive,
  after: OpenedRecorderArchive,
  replacements: Readonly<Record<SparseTextPath, Uint8Array>>
): void {
  const afterByPath = new Map(
    after.entries.map((entry) => [entry.path, entry])
  );
  if (after.entries.length !== before.entries.length) {
    throw new ColmapError('Archive entry set changed', { kind: 'archive' });
  }

  for (const original of before.entries) {
    const copied = afterByPath.get(original.path);
    if (copied === undefined || copied.kind !== original.kind) {
      throw new ColmapError('Archive entry path or kind changed', {
        kind: 'archive',
        path: original.path,
      });
    }
    if (original.kind === 'directory') continue;

    const expected = replacementPaths.includes(original.path as SparseTextPath)
      ? replacements[original.path as SparseTextPath]
      : original.bytes;
    if (!sameBytes(expected, copied.bytes)) {
      throw new ColmapError('Archive entry bytes changed unexpectedly', {
        kind: 'archive',
        path: original.path,
      });
    }
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

function wrapArchive(archive: OpenedRecorderArchive): RecorderArchiveSource {
  return archive as InternalArchiveSource;
}

function unwrapArchive(source: RecorderArchiveSource): OpenedRecorderArchive {
  return source as InternalArchiveSource;
}
