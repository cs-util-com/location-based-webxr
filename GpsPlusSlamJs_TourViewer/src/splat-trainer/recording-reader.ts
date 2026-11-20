/**
 * Reads a recorder zip into what a splat trainer needs: the camera
 * captures with their raw WebXR poses, one PINHOLE lens, the depth
 * samples, a census to show before any training, and a fingerprint that
 * ties later work to this exact file. Every refusal is a sentence a
 * creator can read; nothing here throws for a bad file.
 *
 * @see recording-reader.ts.md
 */

import { ZipReader, type Entry, type FileEntry } from "@zip.js/zip.js";
import type {
  Matrix4,
  Quaternion,
  Vector3,
} from "gps-plus-slam-app-framework/core";
import type { DepthSample } from "gps-plus-slam-app-framework/state";
import {
  ArchiveLimitError,
  ByteSourceReader,
  DecompressionBudget,
  listZipEntriesCapped,
  loadActionsFromEntries,
  LocalCacheByteSource,
  readZipEntryText,
  type ArchiveLimits,
} from "gps-plus-slam-app-framework/storage";
import { resolveArchiveLimits } from "gps-plus-slam-app-framework/storage/archive-limits";
import { DEPTH_SAMPLE_ACTION_TYPE } from "gps-plus-slam-app-framework/storage/depth-sample-codec";
import { interpolatingMedian } from "gps-plus-slam-app-framework/utils/median";
import {
  pinholeFromProjection,
  type PinholeIntrinsics,
} from "gps-plus-slam-app-framework/utils/pinhole-from-projection";

import {
  CAPTURE_ACTION,
  NEWEST_KNOWN_ODOM_COORD_VERSION,
  preflightCaptureJoin,
} from "../capture-geo-join.js";
import { tourFileKey } from "../tour-file-key.js";
import { isActionEntryName, recordingFoldersOf } from "../tour-read-set.js";

/**
 * How far two depth samples' lenses may differ and still be one lens: per
 * lens element of the projection (`LENS_ELEMENTS`), relative to the larger
 * magnitude of the two, with a floor of 1 so that elements near zero
 * compare in absolute terms. A session's matrix is constant up to float
 * round-off (about 1e-7 for float32), so 1e-4 passes jitter and refuses
 * any real change of lens: a zoom or crop moves the focal terms by
 * percent, not by parts per ten thousand. One device measured so far
 * (spread 0); the census reports the spread for any other.
 */
export const PROJ_TOL = 1e-4;

/**
 * The projection elements the lens is made of: the focal terms (0, 5) and
 * the centre terms (8, 9), the only ones `pinholeFromProjection` reads.
 * The clip planes (10, 14) are left out on purpose: an app may move them
 * mid-session without any change of lens.
 */
const LENS_ELEMENTS = [0, 5, 8, 9] as const;

/**
 * How far the lens's pixels may be from square, as `|fx / fy - 1|`: the
 * frustum's shape must match the photos' shape. Real lenses show a
 * fraction of a percent; a frustum made for another frame shape (a square
 * one on 4:3 photos, or landscape on portrait) is off by tens of percent.
 * 2 % sits between. A value that would change it: a device whose genuine
 * pixel aspect is off by more than 2 % (it would be refused), or a frame
 * mismatch smaller than 2 % that visibly stretches a splat.
 */
export const ASPECT_TOL = 0.02;

/** One camera capture whose photo the zip carries. */
interface SplatCapture {
  /** The photo's archive entry name (under the recording's folder). */
  readonly entry: string;
  /** Camera position, raw WebXR (metres, the recording's AR origin). */
  readonly position: Vector3;
  /** Camera rotation, raw WebXR `[x, y, z, w]`. */
  readonly rotation: Quaternion;
  /** The screen rotation the capture recorded (degrees). */
  readonly screenRotation: number;
  /** Epoch milliseconds, or null when the capture carries no time. */
  readonly capturedAt: number | null;
}

/** What the page shows before any training; nothing here decodes a photo. */
interface SplatCensus {
  /** Captures kept (their photo is in the zip). */
  readonly frames: number;
  /** Captures skipped because the zip carries no photo for them. */
  readonly skippedFrames: number;
  /** Length of the camera path through the kept captures, metres. */
  readonly pathM: number;
  /** Median step between consecutive kept captures, or null below two. */
  readonly medianSpacingM: number | null;
  /** Median time between consecutive kept captures, or null below two or
   *  when any of them carries no time. */
  readonly medianSpacingS: number | null;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Depth samples carrying a projection matrix. */
  readonly depthSamples: number;
  /** Largest relative difference of any depth sample's lens elements
   *  from the first one's (see `PROJ_TOL`). */
  readonly projectionSpread: number;
  /** The recording format's era (`session.json` `odomCoordVersion`). */
  readonly era: number;
}

/** Ties later work (a resumed training) to this exact file. */
interface SplatFingerprint {
  readonly size: number;
  /** The File's last-modified time, or null for a plain Blob. */
  readonly lastModified: number | null;
  /** The recording's content key (`tourFileKey`): a hash of every file
   *  entry's name, unpacked size and CRC-32 from the zip's directory, so a
   *  same-size change of content changes it too. */
  readonly contentKey: string;
}

export interface SplatInputs {
  readonly captures: readonly SplatCapture[];
  /** The lens, for photos of `census.frameWidth` x `census.frameHeight`. */
  readonly intrinsics: PinholeIntrinsics;
  /** The first depth sample's projection matrix, the lens's source. */
  readonly projectionMatrix: Matrix4;
  /** Every depth sample carrying a projection matrix, in recorded order. */
  readonly depthSamples: readonly DepthSample[];
  readonly census: SplatCensus;
  readonly fingerprint: SplatFingerprint;
}

export type SplatInputsRead =
  | { readonly kind: "read"; readonly inputs: SplatInputs }
  | { readonly kind: "refused"; readonly reason: string };

/** A refusal carried out of the reading steps; caught at the boundary. */
class Refusal extends Error {}

/**
 * Read `file` (a recorder zip) into the trainer's inputs, or say in words
 * why it cannot be trained. `limits` tightens the archive caps (tests;
 * the defaults are the framework's). The zip is read lazily: its
 * directory, `session.json` and the action stream, never a photo.
 */
export async function readSplatInputs(
  file: Blob,
  options: { readonly limits?: Partial<ArchiveLimits> } = {},
): Promise<SplatInputsRead> {
  // Outside the refusals on purpose: a cap of 0 or NaN is a configuration
  // mistake that throws, not a bad file. One budget serves every read of
  // this archive, bounding what it may inflate in total.
  const limits = resolveArchiveLimits(options.limits);
  const budget = DecompressionBudget.forArchive(file.size, limits);
  try {
    return { kind: "read", inputs: await readInputs(file, limits, budget) };
  } catch (err) {
    if (err instanceof Refusal || err instanceof ArchiveLimitError) {
      return { kind: "refused", reason: err.message };
    }
    const detail = err instanceof Error ? err.message : String(err);
    return {
      kind: "refused",
      reason: `The recording could not be read (${detail}).`,
    };
  }
}

async function readInputs(
  file: Blob,
  limits: ArchiveLimits,
  budget: DecompressionBudget,
): Promise<SplatInputs> {
  if (file.size > limits.maxArchiveBytes) {
    throw new ArchiveLimitError(
      "archive-bytes",
      limits.maxArchiveBytes,
      file.size,
    );
  }
  const reader = new ZipReader(
    new ByteSourceReader(
      new LocalCacheByteSource(file),
      limits.maxDirectoryBytes,
    ),
  );
  try {
    let entries: Entry[];
    try {
      entries = await listZipEntriesCapped(reader, limits.maxEntries);
    } catch (err) {
      if (err instanceof ArchiveLimitError) throw err;
      throw new Refusal("This file is not a zip recording.");
    }
    return await readEntries(file, entries, limits, budget);
  } finally {
    await reader.close();
  }
}

async function readEntries(
  file: Blob,
  entries: readonly Entry[],
  limits: ArchiveLimits,
  budget: DecompressionBudget,
): Promise<SplatInputs> {
  const files = entries.filter((e): e is FileEntry => !e.directory);
  const names = files.map((e) => e.filename);
  if (!names.some(isActionEntryName)) {
    throw new Refusal("This zip holds no recording (it has no actions).");
  }
  const folders = recordingFoldersOf(names);
  if (folders.length > 1) {
    throw new Refusal(
      `This zip holds more than one recording (${folders.map((f) => f || "the top level").join(", ")}). Give the trainer one recording at a time.`,
    );
  }
  const folder = folders[0] ?? "";
  const readText = (entry: FileEntry, maxBytes: number): Promise<string> =>
    readZipEntryText(
      entry,
      budget,
      Math.min(maxBytes, limits.maxTextEntryBytes),
    );

  const era = await readEra(files, `${folder}session.json`, readText);
  const actions = (await loadActionsFromEntries(entries, readText)).map(
    (e) => e.action,
  );
  const preflight = preflightCaptureJoin(
    { odomCoordVersion: era },
    actions.map((a) => a.type),
  );
  if (!preflight.ok) throw new Refusal(asSentence(preflight.reason));
  if (typeof era !== "number" || era > NEWEST_KNOWN_ODOM_COORD_VERSION) {
    throw new Refusal(
      "The recording is newer than this page understands; open it in a newer version.",
    );
  }

  const present = new Set(names);
  const { captures, sizes, skipped } = capturesOf(actions, folder, present);
  if (captures.length === 0) {
    throw new Refusal(
      skipped > 0
        ? "None of the recording's camera captures has its photo in the zip."
        : "The recording has no camera captures.",
    );
  }
  const frame = frameSizeOf(sizes);
  const depthSamples = depthSamplesOf(actions);
  const reference = depthSamples[0]?.projectionMatrix;
  if (reference === undefined) {
    throw new Refusal(
      actions.some((a) => a.type === DEPTH_SAMPLE_ACTION_TYPE)
        ? "This recording's depth data does not include the camera's lens, so the lens is unknown. Recordings from a current recorder include it."
        : "This recording has no depth data, so the camera's lens is unknown. Record with depth on.",
    );
  }
  const projectionSpread = depthSamples.reduce(
    (spread, s) =>
      Math.max(
        spread,
        matrixSpread(reference, s.projectionMatrix ?? reference),
      ),
    0,
  );
  if (projectionSpread > PROJ_TOL) {
    throw new Refusal(
      `The camera's lens changed during the recording: its projection differs by up to ${projectionSpread.toPrecision(2)}, more than the ${String(PROJ_TOL)} allowed.`,
    );
  }
  let intrinsics: PinholeIntrinsics;
  try {
    intrinsics = pinholeFromProjection(reference, frame.width, frame.height);
  } catch {
    throw new Refusal("The recording's lens data cannot be used.");
  }
  const stretch = Math.abs(intrinsics.fx / intrinsics.fy - 1);
  if (stretch > ASPECT_TOL) {
    throw new Refusal(
      `The recording's lens does not fit the shape of its photos (it would stretch them by ${String(Math.round(stretch * 100))} %).`,
    );
  }

  return {
    captures,
    intrinsics,
    projectionMatrix: reference,
    depthSamples,
    census: {
      frames: captures.length,
      skippedFrames: skipped,
      ...spacingOf(captures),
      frameWidth: frame.width,
      frameHeight: frame.height,
      depthSamples: depthSamples.length,
      projectionSpread,
      era,
    },
    fingerprint: {
      size: file.size,
      lastModified: file instanceof File ? file.lastModified : null,
      contentKey: await tourFileKey(files),
    },
  };
}

/** The era `session.json` declares, typed `unknown` on purpose: the file
 *  is hand-editable, and the era rule checks the type itself. */
async function readEra(
  files: readonly FileEntry[],
  name: string,
  readText: (entry: FileEntry, maxBytes: number) => Promise<string>,
): Promise<unknown> {
  const entry = files.find((e) => e.filename === name);
  if (entry === undefined) {
    throw new Refusal(
      "The recording has no session.json, so its format is unknown.",
    );
  }
  let meta: unknown;
  try {
    meta = JSON.parse(await readText(entry, Number.MAX_SAFE_INTEGER));
  } catch (err) {
    if (err instanceof ArchiveLimitError) throw err;
    throw new Refusal("The recording's session.json cannot be read.");
  }
  return typeof meta === "object" && meta !== null
    ? (meta as { odomCoordVersion?: unknown }).odomCoordVersion
    : undefined;
}

interface RecordedAction {
  readonly type: string;
  readonly payload?: unknown;
}

interface CapturePayload {
  readonly imageFile: string;
  readonly position: Vector3;
  readonly rotation: Quaternion;
  readonly screenRotation: number;
  readonly capturedAt: number | null;
  readonly width: unknown;
  readonly height: unknown;
}

/** The file a capture action names, or null when it names none. */
function captureFileOf(action: RecordedAction): string | null {
  const p = action.payload as Record<string, unknown> | null | undefined;
  if (typeof p !== "object" || p === null) return null;
  return typeof p.imageFile === "string" && p.imageFile !== ""
    ? p.imageFile
    : null;
}

/** A capture action's payload, for a capture whose photo the zip
 *  carries; one without a valid pose is refused, never guessed. */
function capturePayloadOf(
  action: RecordedAction,
  imageFile: string,
): CapturePayload {
  const p = action.payload as Record<string, unknown>;
  if (
    !isFiniteTuple<Vector3>(p.position, 3) ||
    !isFiniteTuple<Quaternion>(p.rotation, 4)
  ) {
    throw new Refusal(`The camera capture ${imageFile} carries no valid pose.`);
  }
  return {
    imageFile,
    position: [...p.position],
    rotation: [...p.rotation],
    screenRotation:
      typeof p.screenRotation === "number" && Number.isFinite(p.screenRotation)
        ? p.screenRotation
        : 0,
    capturedAt:
      typeof p.capturedAt === "number" && Number.isFinite(p.capturedAt)
        ? p.capturedAt
        : null,
    width: p.width,
    height: p.height,
  };
}

/**
 * The captures whose photo the zip carries, one per file: a file captured
 * again keeps its last pose and size, as the zip keeps its last write. A
 * capture naming no file, or one the zip lacks, is skipped and counted
 * before its pose is looked at (it is never trained on). Ordered by
 * capture time when every kept capture carries one (the recorder may
 * dispatch them out of order); otherwise in recorded order.
 */
function capturesOf(
  actions: readonly RecordedAction[],
  folder: string,
  present: ReadonlySet<string>,
): { captures: SplatCapture[]; sizes: unknown[][]; skipped: number } {
  const byEntry = new Map<string, { capture: SplatCapture; size: unknown[] }>();
  let skipped = 0;
  for (const action of actions) {
    if (action.type !== CAPTURE_ACTION) continue;
    const imageFile = captureFileOf(action);
    const entry = imageFile === null ? null : `${folder}${imageFile}`;
    if (imageFile === null || entry === null || !present.has(entry)) {
      skipped += 1;
      continue;
    }
    const p = capturePayloadOf(action, imageFile);
    // Delete first so a re-capture takes its new place in recorded order.
    byEntry.delete(entry);
    byEntry.set(entry, {
      capture: {
        entry,
        position: p.position,
        rotation: p.rotation,
        screenRotation: p.screenRotation,
        capturedAt: p.capturedAt,
      },
      size: [p.width, p.height],
    });
  }
  const kept = [...byEntry.values()];
  if (kept.every((k) => k.capture.capturedAt !== null)) {
    // Array.prototype.sort is stable, so equal times keep recorded order.
    kept.sort(
      (a, b) => (a.capture.capturedAt ?? 0) - (b.capture.capturedAt ?? 0),
    );
  }
  return {
    captures: kept.map((k) => k.capture),
    sizes: kept.map((k) => k.size),
    skipped,
  };
}

/** The one photo size of the kept captures (`[width, height]` each,
 *  at least one); refused when a capture does not record it or two differ:
 *  one lens fits one size only. */
function frameSizeOf(sizes: readonly unknown[][]): {
  width: number;
  height: number;
} {
  const [width, height] = sizes[0] ?? [];
  for (const [w, h] of sizes) {
    if (!isPositiveInteger(w) || !isPositiveInteger(h)) {
      throw new Refusal(
        "The recording does not say how large its photos are, so the lens cannot be fitted to them.",
      );
    }
    if (w !== width || h !== height) {
      throw new Refusal("The recording's photos are not all the same size.");
    }
  }
  return { width: width as number, height: height as number };
}

/** The depth samples carrying a well-formed projection matrix. */
function depthSamplesOf(actions: readonly RecordedAction[]): DepthSample[] {
  const samples: DepthSample[] = [];
  for (const action of actions) {
    if (action.type !== DEPTH_SAMPLE_ACTION_TYPE) continue;
    const s = action.payload as Partial<DepthSample> | null | undefined;
    if (
      typeof s === "object" &&
      s !== null &&
      isFiniteTuple(s.projectionMatrix, 16) &&
      isFiniteTuple(s.cameraPos, 3) &&
      isFiniteTuple(s.cameraRot, 4) &&
      Array.isArray(s.points)
    ) {
      samples.push(s as DepthSample);
    }
  }
  return samples;
}

/** Largest difference of `m`'s lens elements from `ref`'s, relative to
 *  the larger magnitude of the two with a floor of 1 (see `PROJ_TOL`). */
function matrixSpread(ref: Matrix4, m: Matrix4): number {
  let spread = 0;
  for (const i of LENS_ELEMENTS) {
    const a = ref[i] ?? 0;
    const b = m[i] ?? 0;
    const diff = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);
    if (diff > spread) spread = diff;
  }
  return spread;
}

function spacingOf(captures: readonly SplatCapture[]): {
  pathM: number;
  medianSpacingM: number | null;
  medianSpacingS: number | null;
} {
  const steps: number[] = [];
  const gaps: number[] = [];
  for (let i = 1; i < captures.length; i++) {
    const a = captures[i - 1];
    const b = captures[i];
    if (a === undefined || b === undefined) continue;
    steps.push(
      Math.hypot(
        b.position[0] - a.position[0],
        b.position[1] - a.position[1],
        b.position[2] - a.position[2],
      ),
    );
    if (a.capturedAt !== null && b.capturedAt !== null) {
      gaps.push((b.capturedAt - a.capturedAt) / 1000);
    }
  }
  return {
    pathM: steps.reduce((sum, s) => sum + s, 0),
    medianSpacingM: steps.length === 0 ? null : interpolatingMedian(steps),
    // Every capture timed, or no time spacing: a gap across an untimed
    // capture would be two steps measured as one.
    medianSpacingS:
      gaps.length === 0 || gaps.length !== steps.length
        ? null
        : interpolatingMedian(gaps),
  };
}

function isFiniteTuple<T extends readonly number[] = number[]>(
  value: unknown,
  length: number,
): value is T {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** A reason fragment as a sentence: capital first letter, full stop. */
function asSentence(reason: string): string {
  const text = reason.charAt(0).toUpperCase() + reason.slice(1);
  return text.endsWith(".") ? text : `${text}.`;
}
