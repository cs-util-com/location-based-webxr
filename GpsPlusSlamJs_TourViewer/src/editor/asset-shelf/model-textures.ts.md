# model-textures.ts

**Purpose:** a 3D model's embedded textures made smaller with the picture step's device (`picture-step.ts`), in a format every glTF viewer reads without an extension.

## Public API

- `imageUses(json)`: how the materials use each image, by image index: `colour` (base colour, emission), `data` (normal, occlusion, metalness and roughness, and any `...Texture` inside a material extension), `alpha` (a base colour of a material whose `alphaMode` is `BLEND` or `MASK`).
- `textureFormat(use, mime, settings)`: alpha use as PNG; data as JPEG at `dataQuality`, or PNG when it came as PNG (a lossless map stays lossless); colour as JPEG at `colourQuality`. With `settings.textureType` set to `image/webp`, WebP replaces JPEG in both lossy choices; PNG stays PNG.
- `shrinkTextures(parts, settings, device, control, span?)`: changes `parts` in place (a rewritten image gets a new buffer view and its `mimeType`); reports `{ changed, kept, bytesBefore, bytesAfter, largestSide }`; `largestSide` counts every image a texture uses from the binary chunk, one left as it is (WebP, undecodable) by its file header (`imageInfo` of the framework's `utils/image-header`), so a large image the pass cannot rewrite never reads as small. Progress runs from `span.from` to `span.to`.

## Invariants

- The longest side is at most `textureMaxSidePx`, never enlarged (`fitWithin`).
- Decoded as a `"texture"`: no colour-profile conversion and no premultiplied alpha, as three.js decodes it, so data maps keep their values.
- Left as they are: an image no texture names, one kept elsewhere than the binary chunk, one of another type (WebP), one the device cannot decode, a PNG that needs no resizing, and a result that is neither resized nor smaller.
- Format order (`textureFormat`): alpha first (PNG), then data (a PNG stays PNG, else JPEG at `dataQuality`), then colour (JPEG at `colourQuality`). An image used both as colour and as data takes the data rule: the stricter use wins, since banding in the lighting shows more than a slightly larger file.
- A texture whose image was written as WebP names it through `EXT_texture_webp` (`{ source }` in its extensions, no core `source`, which a viewer would read as JPEG or PNG), and the file lists the extension in `extensionsUsed` and `extensionsRequired`, once.
- A device that writes another type than asked fails the job (no PNG labelled JPEG).
- Every decoded picture is closed; a stop throws an `AbortError` between images.
- An image over the tour's pixel cap (4096 x 4096) never gets here: `readTourFile` refuses such a model when it comes in (see `asset-optimizers.ts.md`).

## Tests

- `model-textures.test.ts` with a fake device (`test-support/fake-picture-device.ts`): roles and formats, resizing to the limit, the decode purpose, alpha kept as PNG, what is kept, an image used both ways, an undecodable and a WebP image (their header size counted), WebP in place of JPEG and its naming through `EXT_texture_webp`, a stop, a wrong encoder.
- The browser's device on real models: the optimizer e2e (`playwright-tests/editor-asset-optimizers.spec.js`).
