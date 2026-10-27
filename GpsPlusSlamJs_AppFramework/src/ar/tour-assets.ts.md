# tour-assets.ts

## Purpose

The media files of `tour.json` version 4: every picture, sound, video and
3D model a tour shows is an ASSET with its own id and its file
`content/<id>.<ext>` in the tour's archive - a captured photo too (its
bytes stay at `content/<id>.<ext>`, the asset carrying the picture's own
id). Blocks, a station's card image and the tour's cover name assets by
id.

## Public API

- `TourAssetKind` - `image | model | audio | video`, derived from the
  file's extension (the media allowlist, `tour-media.ts`), never stored.
- `TourAsset` - `{ id, path, kind, width?, height? }`; the pixel size is
  for images only.
- `parseTourAsset(value, at, { fail, lenient? }): TourAsset | null` - one
  asset record; null when a lenient read meets a well-formed path of a
  media type this reader does not know. Also the rule for the asset entry
  a creator's draft keeps beside a captured picture
  (`tour-manifest.ts` `parseTourObject`).
- `parseTourAssets(value, { fail, lenient? }): TourAsset[]` - the list,
  each record read and no id twice (`duplicate asset id "<id>"`).

## Invariants & assumptions

- **Asset ids are a namespace of their own.** A block may carry the same
  id as an asset (every reference says which kind it names: a `show` a
  block, a picture's `image` an asset), which is exactly what a captured
  photo mints.
- **The path is the id's own content entry**: `content/<id>.<ext>`, the
  extension on the allowlist. SVG is not on it (it can carry script).
- A width and height come together, positive integers, and only on an
  image.
- **Lenient for a newer minor**: an asset of an unknown media type is left
  out, and whatever names it is skipped by its own reader. At this
  reader's own minor the same asset fails the file.
- The caller's `fail` throws its own error (the manifest's).

## Examples

```ts
const assets = parseTourAssets(data.assets ?? [], { fail, lenient });
// [{ id: 'gate', path: 'content/gate.jpg', kind: 'image', width: 800, height: 600 }]
```

## Tests

- `tour-manifest.test.ts` - an asset path that is not its own entry, an
  SVG, a zero size, a duplicate id, a picture naming a non-image asset,
  block and asset ids as separate namespaces.
- `tour-stations.test.ts` and `tour-stations.property.test.ts` - assets
  of a newer media type left out leniently, and every reference that
  survives resolving.
- `tour-manifest.test.ts` (`parseTourObject`) - a draft picture's asset
  entry checked by this rule.
