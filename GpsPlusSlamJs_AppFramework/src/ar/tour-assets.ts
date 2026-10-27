/**
 * The media files of `tour.json`: every picture, sound, video and 3D model
 * a tour shows is an ASSET with its own id and its file
 * `content/<id>.<ext>` in the tour's archive. Blocks, a station's card
 * image and the tour's cover name assets by id (version 4: a captured
 * photo is an image asset too, its bytes at `content/<id>.<ext>` as
 * before).
 *
 * Asset ids are a namespace of their own: no id is shared with a block
 * here, since every reference says which kind it names. An asset id must
 * not repeat.
 *
 * LENIENT for a NEWER MINOR: an asset of a media type this reader does not
 * know (a well-formed `content/<id>.<ext>` of a type a newer app added) is
 * left out, and whatever names it is skipped by its own reader. At this
 * reader's own minor the same asset fails the file.
 *
 * @see tour-assets.ts.md
 */

import { isRecord } from '../utils/json-guards.js';
import {
  assertUniqueTourIds,
  isPositiveInteger,
  requireTourArray,
  requireTourId,
  type TourFail,
} from './tour-fields.js';
import { tourMediaTypeOf } from './tour-media.js';

/** What an asset is, from its file's extension (the media allowlist). */
export type TourAssetKind = 'image' | 'model' | 'audio' | 'video';

/** One media file of the tour, named by its own id. */
export interface TourAsset {
  /** Short path-safe id; also the content file's stem. */
  readonly id: string;
  /** `content/<id>.<ext>`, the extension an allowlisted media type. */
  readonly path: string;
  /** Derived from the extension, never stored: one source of truth. */
  readonly kind: TourAssetKind;
  /** Pixel size, images only (an aspect-correct plane without decoding). */
  readonly width?: number;
  readonly height?: number;
}

/** An asset's content path, capturing the extension. */
const ASSET_PATH = /^content\/[A-Za-z0-9_-]+\.([a-z0-9]{1,5})$/;

function parseAssetSize(
  value: Record<string, unknown>,
  kind: TourAssetKind,
  at: string,
  fail: TourFail
): { width?: number; height?: number } {
  const { width, height } = value;
  if (width === undefined && height === undefined) return {};
  if (kind !== 'image') fail(`"${at}.width"/"height" are only for an image`);
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    fail(`"${at}.width"/"height" must be positive integers`);
  }
  return { width, height };
}

/** An asset's path `content/<id>.<ext>` with its media type; `unknown-type`
 *  for a well-formed path of a type not on the allowlist; null otherwise. */
function assetMediaOf(
  value: unknown,
  id: string
):
  | { path: string; type: NonNullable<ReturnType<typeof tourMediaTypeOf>> }
  | 'unknown-type'
  | null {
  if (typeof value !== 'string') return null;
  const extension = ASSET_PATH.exec(value)?.[1];
  if (extension === undefined || value !== `content/${id}.${extension}`) {
    return null;
  }
  const type = tourMediaTypeOf(extension);
  return type === null ? 'unknown-type' : { path: value, type };
}

/**
 * One asset record at `at`, or null when a lenient reader does not know
 * its media type. Throws through `fail` for anything else that does not
 * read. Also the draft's rule for the asset a captured photo minted
 * (`tour-manifest.ts` `parseTourObject`).
 */
export function parseTourAsset(
  value: unknown,
  at: string,
  options: { readonly fail: TourFail; readonly lenient?: boolean }
): TourAsset | null {
  const { fail } = options;
  if (!isRecord(value)) return fail(`"${at}" must be an object`);
  const id = requireTourId(value.id, `${at}.id`, fail);
  const media = assetMediaOf(value.path, id);
  if (media === 'unknown-type' && options.lenient === true) return null;
  if (media === null || media === 'unknown-type') {
    return fail(
      `"${at}.path" must be content/${id}.<ext> (an allowlisted media type)`
    );
  }
  const { path, type } = media;
  return {
    id,
    path,
    kind: type.kind,
    ...parseAssetSize(value, type.kind, at, fail),
  };
}

/**
 * Validate the tour's media assets: each one's record, and no id twice.
 * `lenient` (a newer minor) leaves out an asset of an unknown media type.
 */
export function parseTourAssets(
  value: unknown,
  options: { readonly fail: TourFail; readonly lenient?: boolean }
): TourAsset[] {
  const assets = requireTourArray(value, 'assets', options.fail).flatMap(
    (a, i) => {
      const asset = parseTourAsset(a, `assets[${String(i)}]`, options);
      return asset === null ? [] : [asset];
    }
  );
  assertUniqueTourIds(
    assets.map((a) => a.id),
    'asset',
    options.fail
  );
  return assets;
}
