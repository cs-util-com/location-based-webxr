# tour-media.ts

## Purpose

The one allowlist of media a tour archive may carry - extensions and the
MIME types they are served as - plus the inertness check for `.glb`
models. Tour content stays inert, because the page that opens a tour from
any link is the origin that will hold a creator's signing key.

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
  measured from its header against the cap, and its accessors' memory
  against the accessor cap.
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
  `images[].uri` is absent or a `data:` URI three.js reads as data (it
  must match `/^data:.*,.*$/`, three's own test: a comma, no line break;
  any other is resolved against the loader's path and fetched) - never a
  relative path or an http URL the page would fetch - and it uses none of
  the extensions that need a decoder from outside (`KHR_draco_mesh_compression`,
  `EXT_meshopt_compression`, `KHR_meshopt_compression`, `KHR_texture_basisu`).
  Only buffer 0 may leave out its `uri` (it is then the binary chunk):
  three.js resolves a later buffer without one to the empty URL and
  fetches the page itself, so such a buffer is refused.
- **Lists and references are read as three.js reads them.** three reads
  `json.buffers[i]`, `json.bufferViews[i]` and the like by key, so
  `buffers`, `bufferViews`, `accessors` and `images` must each be a list
  when present: an object `buffers` with an http URI under key `0` passed
  the check and made every open of the tour fetch it. Every buffer view's
  `buffer`, and the `buffer` of any of its extensions, must be a whole
  number of at least 0: `"0"` is not buffer 0 to three's `=== 0`, so it
  is fetched as the page itself, and the meshopt plugin loads the buffer
  its extension names before it looks for a decoder, declared or not.
  Behaviour checked in three 0.170.0, 0.180.0 and 0.185.1.
- **The chunk structure is exactly what the format allows**: one JSON chunk, an optional binary chunk, then the end, with
  the header's length equal to the data's. three.js's loader walks EVERY
  chunk and takes a later JSON chunk over the first, so a check of the
  first chunk alone passed a model whose second JSON chunk points at an
  http URL. The chunks are read by the shared `utils/glb-chunks.ts`
  (`readGlbChunks`), the reader the Tour Viewer's model optimizer and its
  check page use too; its reasons are the ones this check returns.
- **The pixel cap:** an image is decoded at the size its
  file states, so a few kilobytes of crafted header can make a phone
  allocate gigabytes. `TOUR_MAX_IMAGE_PIXELS` is 4096 x 4096 (16.8 MP, 64
  MiB once decoded, also iOS Safari's largest canvas): it admits a 12 MP
  phone photo and a 4096 px texture, and refuses a 48 MP photo (186 MiB)
  and an 8192 px texture (256 MiB). Swept in the tests: 4.2 MP refuses a
  phone photo, 8.4 MP admits only a figure, 33.6 MP lets one decode take
  128 MiB. Reversed by a phone that cannot hold one 64 MiB decode beside
  its AR session (unmeasured), or tours that need 8K textures.
- `checkGlbInert` measures every `images[]` entry from the bytes three.js's
  GLTFLoader would decode: its buffer view whenever it names one (three
  prefers it over a `uri` beside it), else its base64 `data:` URI. A buffer
  view is read from the buffer three loads (`loadBuffer`): its `data:` URI
  whenever the buffer has a `uri` (buffer 0 too), the binary chunk only for
  buffer 0 without one. Measuring the binary chunk for buffer 0 regardless
  let a 4 x 4 header there pass while its `data:` buffer held a
  16384 x 16384 picture (1 GiB decoded). Every `data:` URI is read strictly
  by `utils/data-uri.ts` (the decoder the Tour Viewer's glTF import uses
  too; whitespace or missing padding is unreadable), capped at the file's
  own length; an image it cannot find or measure refuses the model.
- **The accessor memory cap:** three.js allocates an accessor without a
  buffer view, and a sparse one, as a new array of `count` elements
  (`loadAccessor`), and uploads every accessor to the GPU, so a few bytes
  of JSON (`count: 100000000`, `VEC4`, float) made a phone allocate
  1.6 GB. The sum of `count` x item size x component bytes over every
  accessor (sparse ones and ones with a buffer view included) may be at
  most 64 MiB, or 8 times the file's length when that is more; an
  accessor whose count (a whole number of at least 0), type or component
  type cannot be read refuses the model. Measured on 48 real models (this
  repo's and others on the development machine): the most any asked for
  was 3.7 MB, the highest ratio to its file's length 3.69 (a 44 KB
  model), the repo's LOD prototypes 2.28 (accessors left without a buffer
  view). Swept: without a floor, a factor of 1 refuses 3 of them, 2
  refuses 2, 4 and more none; with a floor of 16 or 64 MiB no factor from
  1 to 16 refuses any. Reversed by a real model of more than 8 MiB whose
  accessors ask for more than 8 times its length (overlapping accessors,
  many sparse morph targets): none was found.
- `checkGlbInert` never throws, whatever the bytes.
- Pure: no I/O, no DOM.

## Who uses it

- `tour-archive.ts`: `tourContentEntryName` accepts only allowlisted
  extensions (before this allowlist, any 1-5 characters).
- `tour-manifest.ts`: a photo's `content/<id>.<ext>` must be an image.
- The Tour Viewer's `tour-session.ts`: the gallery's image test, the Blob
  type of every entry, and `loadContentEntry`, which refuses a
  non-allowlisted name and a `.glb` that fails `checkGlbInert`.

## Tests

`tour-media.test.ts`: the pixel cap and its sweep, a model's images in
the binary chunk and as `data:` URIs, an unmeasurable or unfindable image,
a set cap; an image `data:` URI read as strict base64 only (spaced
or unpadded refused); the pixel cap measuring what three.js loads (buffer
0 from its `data:` URI rather than the binary chunk, an image in a later
`data:` buffer, a buffer that does not decode strictly, a `bufferView`
preferred over a `uri` beside it, a later buffer without a `uri`
refused; the binary chunk holding a readable header beside an unreadable
`data:` buffer, so no fallback to the chunk); lists and references as
three.js reads them (an object in place of `buffers`, `bufferViews`,
`accessors` or `images` refused; a view whose `buffer`, or whose
extension's `buffer`, is `"0"`, `"length"`, `"constructor"`, fractional,
negative or null refused; `data:x` and a line break before or after the
comma refused for buffers and images); the accessor memory cap (a
1.6 GB accessor refused; 64 MiB admitted in a small file and one byte
more refused; 8 times the length of a 9 MiB file admitted and one byte
more refused; sparse accessors summed; an unreadable count, type or
component type refused); the allowlist's members, that no type able to carry
script or markup is admitted, exact matching, entry names, a never-throws
property; `.glb` inertness with built binaries (binary chunk and `data:`
accepted; http, relative and protocol-relative URIs refused for buffers and
images; a decoder extension refused; not-glTF, version 1, truncated and
non-object JSON refused, the reader's refusal reason passed through
unchanged) and a never-throws property over random bytes;
the chunk structure (JSON plus one binary chunk accepted; a second JSON
chunk with an http URI, a chunk after the binary one, a header length that
is not the data length, trailing bytes and a binary chunk running past the
end refused).
