# tour-media.ts

## Purpose

The one allowlist of media a tour archive may carry - extensions and the
MIME types they are served as - plus the inertness check for `.glb`
models. Tour kit plan K0
(`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`,
review finding D12: content stays inert, because the page that opens a
tour from any link is the origin that will hold a creator's signing key).

## Public API

- `type TourMediaKind = 'image' | 'model' | 'audio' | 'video'`,
  `interface TourMediaType { kind; mime }`
- `TOUR_MEDIA_EXTENSIONS` - every allowlisted extension (lower case).
- `tourMediaTypeOf(extension)` - exact lower-case match (no dot), or
  `null`. `JPG`, `.jpg`, `__proto__` and non-strings are `null`.
- `tourMediaTypeOfEntry(name)` - by an entry name's last extension, case
  folded (a recording's `frame.JPG` is a JPEG); `null` without one.
- `checkGlbInert(bytes)` - `{ ok: true }` or `{ ok: false, reason }` in
  plain words.

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

`tour-media.test.ts`: the allowlist's members, that no type able to carry
script or markup is admitted, exact matching, entry names, a never-throws
property; `.glb` inertness with built binaries (binary chunk and `data:`
accepted; http, relative and protocol-relative URIs refused for buffers and
images; a decoder extension refused; not-glTF, version 1, truncated and
non-object JSON refused) and a never-throws property over random bytes.
