/**
 * A file brought into the open tour (a voice now; pictures, videos, sounds
 * and models with the add flow): read at once, checked against what a tour
 * can carry, and named by its content hash, so the same bytes are one
 * entry of the zip however many items use them. Page-free: the session
 * holds what this returns (its files table) and the draft keeps it.
 *
 * @see tour-files.ts.md
 */

import type {
  TourAsset,
  TourAssetKind,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  checkGlbInert,
  TOUR_MAX_IMAGE_PIXELS,
  TOUR_MEDIA_EXTENSIONS,
  tourMediaTypeOf,
} from "gps-plus-slam-app-framework/ar/tour-media";
import { DEFAULT_ARCHIVE_LIMITS } from "gps-plus-slam-app-framework/storage";
import { formatFileSize } from "gps-plus-slam-app-framework/utils/format-file-size";
import { imageInfoOfBlob } from "gps-plus-slam-app-framework/utils/image-header";
import { sha256Hex } from "gps-plus-slam-app-framework/utils/sha256-hex";

/** The sizes an import is judged by: the archive reader's caps, and a
 *  margin below them for the manifest, the lists and the zip's own
 *  records, so a tour the editor took is one every reader opens. */
export interface TourFileLimits {
  readonly maxEntryBytes: number;
  readonly maxArchiveBytes: number;
  readonly marginBytes: number;
}

export const TOUR_FILE_LIMITS: TourFileLimits = Object.freeze({
  maxEntryBytes: DEFAULT_ARCHIVE_LIMITS.maxEntryBytes,
  maxArchiveBytes: DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes,
  marginBytes: 4 * 1024 * 1024,
});

/** A file read for the tour: its asset, its bytes (a copy in memory),
 *  and whether the tour holds it already (`isNew` false: an asset of the
 *  same bytes is used, nothing is added). A video's minted poster rides
 *  with it, by the same rule. */
export interface TourFileRead {
  readonly kind: "read";
  readonly asset: TourAsset;
  readonly blob: Blob;
  readonly isNew: boolean;
  readonly poster?: {
    readonly asset: TourAsset;
    readonly blob: Blob;
    readonly isNew: boolean;
  };
}

export interface TourFileRefusal {
  readonly kind: "refused";
  readonly reason: string;
}

export interface TourFileContext {
  /** What the tour weighs now: the newest file and the files added
   *  since (`EditorSession.addedBytes`). */
  readonly tourBytes: number;
  /** The asset the tour already holds for these bytes, by content hash. */
  readonly known: (sha: string) => TourAsset | undefined;
  /** The kinds taken here (default: every kind a tour carries). */
  readonly kinds?: readonly TourAssetKind[];
  /** A model's largest side (`largestSide`, the page's three loader); 0
   *  for one that shows nothing. Absent: a model is taken unmeasured. */
  readonly measureModel?: (blob: Blob) => Promise<number>;
  /** A video's first frame as a picture (the page's video element); a
   *  rejection or null mints none. */
  readonly posterOf?: (blob: Blob) => Promise<Blob | null>;
  readonly limits?: TourFileLimits;
}

const UNREAD = "That file could not be read. Is it still where it was?";
const NO_SHAPE =
  "That 3D model has nothing to show: it has no mesh, or its size is zero.";
const MODEL_UNREAD = "That 3D model could not be read.";

/** The extensions of `kinds`, for the refusal's words. */
function extensionsOf(kinds: readonly TourAssetKind[] | undefined): string {
  return TOUR_MEDIA_EXTENSIONS.filter((ext) => {
    const kind = tourMediaTypeOf(ext)?.kind;
    return kind !== undefined && (kinds === undefined || kinds.includes(kind));
  }).join(", ");
}

/** `name`'s extension, lower case, without the dot ("" for none). */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Read `file` (named `fileName`) for the tour: its type by the extension,
 * its size against the caps, its bytes now (a dropped `File` is read from
 * the disk only when asked: a source moved later must not fail a save),
 * then its hash. Never rejects: every failure is a refusal in words.
 */
export async function readTourFile(
  file: Blob,
  fileName: string,
  context: TourFileContext,
): Promise<TourFileRead | TourFileRefusal> {
  const limits = context.limits ?? TOUR_FILE_LIMITS;
  const ext = extensionOf(fileName);
  const type = tourMediaTypeOf(ext);
  if (
    type === null ||
    (context.kinds !== undefined && !context.kinds.includes(type.kind))
  ) {
    return refused(
      `That file is not one this tour can take here (${extensionsOf(context.kinds)}).`,
    );
  }
  const maxEntry = limits.maxEntryBytes - limits.marginBytes;
  if (file.size > maxEntry) {
    return refused(
      `That file is too large for a tour (${formatFileSize(file.size)}; a file can be at most ${formatFileSize(maxEntry)}).`,
    );
  }
  const room = (bytes: number, more: number): TourFileRefusal | null => {
    const maxTour = limits.maxArchiveBytes - limits.marginBytes;
    return context.tourBytes + bytes + more > maxTour
      ? refused(
          `The tour has no room for that file (${formatFileSize(bytes + more)} more on ${formatFileSize(context.tourBytes)}; a tour can be at most ${formatFileSize(maxTour)}).`,
        )
      : null;
  };
  let data: Uint8Array<ArrayBuffer>;
  try {
    data = new Uint8Array(await file.arrayBuffer());
  } catch {
    return refused(UNREAD);
  }
  const blob = new Blob([data], { type: type.mime });
  // Hashed before the room is judged: bytes the tour already holds add
  // nothing, so a tour near its cap still takes them.
  const named = await assetOf(data, ext, type.kind, blob, context);
  const added = (part: { blob: Blob; isNew: boolean }): number =>
    part.isNew ? part.blob.size : 0;
  const full = room(added(named), 0);
  if (full !== null) return full;
  const checked = await checkKind(type.kind, data, blob, context);
  if (checked !== null) return checked;
  if (type.kind !== "video" || context.posterOf === undefined) {
    return { kind: "read", ...named };
  }
  const poster = await posterFor(blob, context);
  if (poster === null || room(added(named), added(poster)) !== null) {
    return { kind: "read", ...named };
  }
  return { kind: "read", ...named, poster };
}

function refused(reason: string): TourFileRefusal {
  return { kind: "refused", reason };
}

/** What a kind must be beyond its type: a model inert and with a shape,
 *  an image within the pixel cap. Null when it passes. */
async function checkKind(
  kind: TourAssetKind,
  data: Uint8Array,
  blob: Blob,
  context: TourFileContext,
): Promise<TourFileRefusal | null> {
  if (kind === "image") {
    const info = await imageInfoOfBlob(blob);
    if (info === null) return refused("That picture's size could not be read.");
    if (info.width * info.height > TOUR_MAX_IMAGE_PIXELS) {
      return refused(
        `That picture is too large to show on a phone (${String(info.width)} x ${String(info.height)} pixels).`,
      );
    }
    return null;
  }
  if (kind !== "model") return null;
  const inert = checkGlbInert(data);
  if (!inert.ok) {
    return refused(`That 3D model cannot be used: ${inert.reason}.`);
  }
  if (context.measureModel === undefined) return null;
  let side: number;
  try {
    side = await context.measureModel(blob);
  } catch {
    return refused(MODEL_UNREAD);
  }
  return side > 0 && Number.isFinite(side) ? null : refused(NO_SHAPE);
}

/** The asset of `data`: the one the tour holds for its hash, else a new
 *  one named by it (an image with its pixel size). */
async function assetOf(
  data: Uint8Array,
  ext: string,
  kind: TourAssetKind,
  blob: Blob,
  context: TourFileContext,
): Promise<{ asset: TourAsset; blob: Blob; isNew: boolean }> {
  const sha = await sha256Hex(data);
  const held = context.known(sha);
  if (held?.kind === kind) return { asset: held, blob, isNew: false };
  const size = kind === "image" ? await imageInfoOfBlob(blob) : null;
  return {
    asset: {
      id: sha,
      path: `content/${sha}.${ext}`,
      kind,
      ...(size === null ? {} : { width: size.width, height: size.height }),
    },
    blob,
    isNew: true,
  };
}

/** A video's minted poster as an image asset, or null when none could be
 *  made or it is no picture a tour takes. */
async function posterFor(
  video: Blob,
  context: TourFileContext,
): Promise<{ asset: TourAsset; blob: Blob; isNew: boolean } | null> {
  let poster: Blob | null;
  try {
    poster = (await context.posterOf?.(video)) ?? null;
  } catch {
    return null;
  }
  if (poster === null) return null;
  const info = await imageInfoOfBlob(poster);
  if (info === null || info.width * info.height > TOUR_MAX_IMAGE_PIXELS) {
    return null;
  }
  const ext = info.type === "jpeg" ? "jpg" : info.type;
  const data = new Uint8Array(await poster.arrayBuffer());
  return assetOf(data, ext, "image", poster, context);
}
