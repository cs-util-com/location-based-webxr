# tour-media.ts

## Purpose

The one allowlist of media a tour archive may carry - extensions and the
MIME types they are served as - plus the inertness check for `.glb`
models. Tour kit plan K0
(`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`,
review finding D12: content stays inert, because the page that opens a
tour from any link is the origin that will hold a creator's signing key).

## Public API

- `interface TourMediaType { kind; mime }` with `kind` one of `image`,
  `model`, `audio`, `video` (the kind type itself is module-private).
- `TOUR_MEDIA_EXTENSIONS` - every allowlisted extension (lower case).
- `tourMediaTypeOf(extension)` - exact lower-case match (no dot), or
  `null`. `JPG`, `.jpg`, `__proto__` and non-strings are `null`.
- `tourMediaTypeOfEntry(name)` - by an entry name's last extension, case
  folded (a recording's `frame.JPG` is a JPEG); `null` without one.
- `checkGlbInert(bytes, { maxImagePixels? })` - `{ ok: true }` or
  `{ ok: false, reason }` in plain words; every image of the model is also
  measured from its header against the cap (K4 review R2).
- `TOUR_MAX_IMAGE_PIXELS` (4096 x 4096) and `checkImageWithinCap(bytes,
maxPixels?)` - the pixel cap every tour image is measured against before
  it is decoded; an image whose size cannot be read is refused too.

## The allowlist

- Images (raster only): `jpg`, `jpeg`, `png`, `webp`, `gif`, `avif` - the
  set the Tour Viewer's gallery already showed. Never SVG: it can carry
  script.
- Models: `glb` only (`model/gltf-binary`), self-contained. Never `.gltf`
  (its buffers are separate files by design).
- Audio: `mp3`, `m4a`, `aac`, `ogg`, `oga`, `opus`, `wav`, `flac`.
- Video: `mp4`, `webm`.
- Every MIME type is `image/`, `audio/`, `video/` or `model/`; none is
  HTML, XML, SVG or script (a test holds that).

## Invariants

- A `.glb` is inert when it is glTF 2.0 binary, every `buffers[].uri` and
  `images[].uri` is absent (the binary chunk) or a `data:` URI - never a
  relative path or an http URL the page would fetch - and it uses none of
  the extensions that need a decoder from outside (`KHR_draco_mesh_compression`,
  `EXT_meshopt_compression`, `KHR_meshopt_compression`, `KHR_texture_basisu`).
- **The chunk structure is exactly what the format allows** (K0 milestone
  review R8): one JSON chunk, an optional binary chunk, then the end, with
  the header's length equal to the data's. three.js's loader walks EVERY
  chunk and takes a later JSON chunk over the first, so a check of the
  first chunk alone passed a model whose second JSON chunk points at an
  http URL.
- **The pixel cap (K4 review R2):** an image is decoded at the size its
  file states, so a few kilobytes of crafted header can make a phone
  allocate gigabytes. `TOUR_MAX_IMAGE_PIXELS` is 4096 x 4096 (16.8 MP, 64
  MiB once decoded, also iOS Safari's largest canvas): it admits a 12 MP
  phone photo and a 4096 px texture, and refuses a 48 MP photo (186 MiB)
  and an 8192 px texture (256 MiB). Swept in the tests: 4.2 MP refuses a
  phone photo, 8.4 MP admits only a figure, 33.6 MP lets one decode take
  128 MiB. Reversed by a phone that cannot hold one 64 MiB decode beside
  its AR session (unmeasured), or tours that need 8K textures.
- `checkGlbInert` measures every `images[]` entry: its buffer view in the
  binary chunk (buffer 0, inside the chunk) or its base64 `data:` URI; an
  image it cannot find or measure refuses the model.
- `checkGlbInert` never throws, whatever the bytes.
- Pure: no I/O, no DOM.

## Who uses it

- `tour-archive.ts`: `tourContentEntryName` accepts only allowlisted
  extensions (before K0: any 1-5 characters).
- `tour-manifest.ts`: a photo's `content/<id>.<ext>` must be an image.
- The Tour Viewer's `tour-session.ts`: the gallery's image test, the Blob
  type of every entry, and `loadContentEntry`, which refuses a
  non-allowlisted name and a `.glb` that fails `checkGlbInert`.

## Tests

`tour-media.test.ts`: the pixel cap and its sweep, a model's images in
the binary chunk and as `data:` URIs, an unmeasurable or unfindable image,
a set cap (R2); the allowlist's members, that no type able to carry
script or markup is admitted, exact matching, entry names, a never-throws
property; `.glb` inertness with built binaries (binary chunk and `data:`
accepted; http, relative and protocol-relative URIs refused for buffers and
images; a decoder extension refused; not-glTF, version 1, truncated and
non-object JSON refused) and a never-throws property over random bytes;
the chunk structure (JSON plus one binary chunk accepted; a second JSON
chunk with an http URI, a chunk after the binary one, a header length that
is not the data length, trailing bytes and a binary chunk running past the
end refused).
