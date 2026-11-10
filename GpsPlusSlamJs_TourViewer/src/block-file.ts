/**
 * An item's file: which kind of file a block is made from, its file's
 * asset id, and the block with another file in its place. The one place
 * that knows each kind's file field, so the inspector's file field, a
 * file dropped on it and the session's `setItemFile` agree.
 *
 * @see block-file.ts.md
 */
import type { TourAssetKind } from "gps-plus-slam-app-framework/ar/tour-manifest";

/** A block as far as its file goes: its kind and its file fields. */
interface FileBlock {
  readonly kind: string;
  readonly image?: string;
  readonly audio?: string;
  readonly video?: string;
  readonly asset?: string;
  readonly poster?: string;
}

/** Each file kind's field on its block. */
const FILE_FIELD = {
  picture: { field: "image", file: "image" },
  audio: { field: "audio", file: "audio" },
  video: { field: "video", file: "video" },
  model: { field: "asset", file: "model" },
} as const satisfies Record<
  string,
  { field: keyof FileBlock; file: TourAssetKind }
>;

type FileKind = keyof typeof FILE_FIELD;

function fileRow(kind: string): (typeof FILE_FIELD)[FileKind] | null {
  return Object.hasOwn(FILE_FIELD, kind) ? FILE_FIELD[kind as FileKind] : null;
}

/** The kind of file `block` is made from; null for a block made of words. */
export function blockFileKind(block: {
  readonly kind: string;
}): TourAssetKind | null {
  return fileRow(block.kind)?.file ?? null;
}

/** The asset id of `block`'s file; null for a block made of words. */
export function blockFileId(block: FileBlock): string | null {
  const row = fileRow(block.kind);
  return row === null ? null : (block[row.field] ?? null);
}

/**
 * `block` with the file `assetId` in place of its own, everything else
 * kept; a video's poster becomes `posterId`, or goes when none is given
 * (the old one showed the old video). Null for a block made of words.
 */
export function withBlockFile<B extends FileBlock>(
  block: B,
  assetId: string,
  posterId?: string,
): B | null {
  const row = fileRow(block.kind);
  if (row === null) return null;
  const next: Record<string, unknown> = { ...block, [row.field]: assetId };
  if (block.kind === "video") {
    if (posterId === undefined) delete next["poster"];
    else next["poster"] = posterId;
  }
  return next as B;
}
