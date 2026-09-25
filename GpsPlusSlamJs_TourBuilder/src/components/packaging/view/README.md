# packaging/view — browser side effects

The DOM half of component 5. `core/` produces values (a `Blob`, a string of SVG);
`qr-view.ts` puts the SVG in front of the user. The `Blob` download side effect
lives upstream now — `downloadZip` from `gps-plus-slam-app-framework/storage`
(File System Access API with an `<a download>` fallback) — so component 5 no
longer needs its own `download-blob.ts`.

`qr-view.ts` is exercised via the demo (`pnpm dev` → `/components/packaging/`),
not unit tests — there is no logic there worth pinning, only the side effect.
`export-qr-image.ts` is the exception: canvas/`Image` decode order and the
white-background guard are worth pinning, so it has real unit tests
(`export-qr-image.test.ts`) stubbing the canvas 2D context the same way
`ar-scene/view/breadcrumb-guide.test.ts` does.

## Modules

- **`qr-view.ts`** — `renderQrSvg(host, svg)`. `innerHTML` is safe here
  specifically because the markup comes from the local `qrcode` encoder, never
  from an author or the network.
- **`export-qr-image.ts`** — `rasterizeQrSvg(svg, format)`, `format` being
  `"png" | "jpeg"`. Draws the QR SVG onto an offscreen canvas at 1024px (well
  past the 512px on-screen size) and resolves a `Blob`. Used by
  `src/app/authoring/pack-and-share-panel.ts` to let the author save/share the
  code as an image, via the framework's `shareOrDownloadBlob` rather than a
  raw `<a download>`.
