# image-sniff.ts

**Purpose:** a picture's type from its first bytes (never its file name or a claimed MIME type), and whether a `.glb` may carry it as it is. The glTF repack types every picture it embeds by this.

## Public API

- `sniffImage(bytes): SniffedImage | null`
  - `{ type: "png" | "jpeg" | "webp" | "avif", mime, embeddable: true, width, height }`: read by the framework's one image-header reader (`utils/image-header.ts`, `imageInfo`); `mime` is the glTF `mimeType` to write.
  - `{ type, mime: null, embeddable: false }` for GIF, BMP, TIFF, PSD, DDS, KTX, KTX2, OpenEXR and Radiance HDR, recognised by their magic numbers so the words can name what was left out.
  - `null` for anything else, including an embeddable type whose header is cut short (its size cannot be read, so it is not embedded unmeasured).

## Invariants

- Pure, never throws, never reads past the buffer (the magic check compares lengths first; `imageInfo` has the same guarantee).
- An embeddable answer always has a MIME type and a positive size.
- WebP and AVIF need `EXT_texture_webp` / `EXT_texture_avif` in the model; the repack keeps whatever the model declares and does not add them (a `.gltf` naming a WebP file already declares its extension).
- TGA has no magic number; later converters recognise it by extension.

## Tests

- `image-sniff.test.ts`: PNG and JPEG with type, MIME and size; every name-only type; null for unknown bytes and a cut PNG header; properties: total on random bytes with every embeddable answer well-formed, and any PNG header's size read back exactly whatever follows.
