# optimizer-settings.ts

**Purpose:** the "smaller files" values in one place, so they can be retuned after a listening and viewing check.

## Public API

- `OPTIMIZER_SETTINGS: OptimizerSettings`:
  - `picture`: `PHOTO_PICTURE`, longest side 1600 px, `image/webp`, quality 0.6 (never enlarged). Chosen by eye on the check page (`asset-optimizer-check.html`): on the sample street photo (2400 x 1800, 800 KiB) 1600 px at 0.6 is about 18 % of the original and small text stays readable zoomed in; at 1600 px and 0.5 (about 16 %) it does not. Before, the default was 0.75 (about 21 %). **One photo was judged**, on a desktop screen: a photo with finer text, or a phone screen, could move it.
    - Flat-colour pictures (cartoons, drawings, many AI-made figures) get the same setting. Measured on two generated cartoons (`editor-asset-optimizers.spec.js`, the flat-colour sweep): the photo setting already makes them 15 to 17 KiB at 1600 px against the photo's 145 KiB, so a second setting has no bytes to save; quality 0.9 would buy cleaner edges and text (PSNR 44 against 41 dB on the flat cartoon, near-worst pixel error 28 against 40) for about 11 KiB more, and lossless WebP costs 3 to 9 times quality 0.9. No classifier picks a setting by picture kind; the check page shows both side by side so the choice can be made by eye.
  - `speech`: Opus 24 kbps mono; `music`: Opus 64 kbps stereo (music and ambience);
  - `model` (`ModelSettings`, `model-step.ts`): textures at most 1024 px on the longest side, colour textures as JPEG 0.85, data textures (normal, roughness and metalness, occlusion) as JPEG 0.92 or kept PNG; 16-bit positions, 8-bit normals and tangents, 16-bit texture coordinates; an error budget of 0.0001 (0.01 % of a mesh's box diagonal). Swept in `model-quantize.test.ts` and the optimizer e2e: 16-bit positions err at most about 0.0013 % (0.00096 to 0.0011 % on the scanned models), so the budget passes them from 0.01 % up and a budget of 0.001 % refuses some; 8-bit positions err about 0.25 to 0.29 % and pass only a 1 % budget; 16-bit normals cost 4 more bytes a vertex for 0.0015 degrees against 0.38; 8-bit texture coordinates save nothing (a vertex attribute is padded to 4 bytes either way). What would reverse the budget: a model whose detail is smaller than 0.01 % of its size, seen from close up.
  - Levels of detail (`model-lod.ts`): a default level within 0.25 % of a primitive's box diagonal (`lodBudget` 0.0025), primitives under 2 000 triangles left alone (`lodMinTriangles`), and `detailShare` left out (the shelf's slider sets it per run). Swept on the three scanned models: at 0.1 % the rock keeps all its 9 932 triangles, the coast rock 53 %, the boulder 82 %; at 0.15 % 97 %, 38 %, 68 %; at 0.25 % 80 %, 17 %, 34 % (the boulder's deviation 5.7 mm); at 0.5 % 36 %, 7 %, 12 %; at 1 % 7 %, 4 %, 5 %. The boulder halves its triangles between 0.15 and 0.25 %, so the budget is the one number that most changes what a tour draws. The floor: the scans first thinned to 500 to 4 000 triangles and then given a default level keep 91 to 100 % of them, so a model near the floor has almost nothing to gain. What would reverse it: a hand-made model of a few thousand triangles drawn far less efficiently than a thinned scan.
  - `textureType` (optional, left out): `image/webp` writes the lossy textures as WebP in place of JPEG, at the same qualities, named through `EXT_texture_webp`; alpha and lossless maps stay PNG. Measured on the check page's three samples at 1024 px: at the shelf's own quality numbers WebP writes 14 to 28 % fewer texture bytes (rock 435 to 375 KiB, bust 624 to 503, box 562 to 407; 11 to 26 % of the whole file), and at the same PSNR about 40 to 45 % fewer (the box's colour maps, on its 2k download before the fixture was re-encoded: JPEG 0.85 421 KiB at 38.1 dB, WebP 0.85 239 KiB at 38.5 dB; WebP 0.75 139 KiB at 36.6 dB against JPEG 0.7 261 KiB at 36.0 dB). It is the check page's texture option, not the shelf's default: a WebP texture needs a viewer that reads the extension (three.js does, and the tour's check accepts it).
  - `keepAbove`: 0.9 - a result larger than this share of the original keeps the original ("at least 10 % smaller").
- `PHOTO_PICTURE`: the picture setting above, named so a retune is a deliberate change.
- `OPTIMIZER_SLOTS`: jobs at once, `{ phone: 1, desktop: 2 }`, provisional until measured on a phone.
- Type `OptimizerSettings` (its picture and sound parts are module-private shapes).

## Invariants

- Nothing else hard-codes a size, quality or bitrate: optimizers read their part from the `settings` of their context (`asset-optimizers.ts`), and the Worker receives them with each run (`optimizer-protocol.ts`).

## Tests

- `optimizer-settings.test.ts`: the photo setting is 1600 px, WebP at 0.6, and is the shelf's picture setting.
- Otherwise values only; read by `asset-shelf.test.ts` (the 10 % rule).
