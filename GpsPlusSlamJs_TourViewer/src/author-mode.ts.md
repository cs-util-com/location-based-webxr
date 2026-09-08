# author-mode.ts

## Purpose

Author mode (QR-pose plan M3): the `?author=1` panel - the mint readout
(stability + alignment gates via `authorStatusLine`), the per-entry author
tracking controller, minting a `qr/<id>.json` level from the stable QR pose
and the session alignment, and the copy/download of that JSON. Its own
module since the flows plan M6.

## Public API

- `wireAuthorMode({ ctx, authorMode, arStore, seams, dom }): AuthorMode`
  - `AuthorModeDom { panel; sizeInput; printPanel; status; mintButton; jsonBox; copyButton; downloadButton; hint }`
    - `sizeInput` lives in the PRINT panel (DEC-F2: one input, two
      consumers); `printPanel` is opened when the size error points at it.
  - `AuthorMode.renderAuthorReadout()` - writes the readout; a persistent
    pipeline error (`ctx.authorErrorText`) has priority over store updates
    (milestone review #5). No-op outside author mode.
  - `AuthorMode.startAuthorPipeline(): boolean` - validates the size,
    creates the author tracking controller into `ctx.qrController`; false
    (reason in the panel) keeps AR unstarted.

## Invariants & assumptions

- Session-state fields it owns on the session object: `lastDetectedText`,
  `activeSizeM`, `authorErrorText`, `gpsSamplesAtSessionStart` (written by
  `ar-entry.ts` at the runtime start), `mintedCodeId`.
- The printed size is CAPTURED at AR entry (`ctx.activeSizeM`); the input is
  disabled during a session in author mode (`ar-entry.ts`).
- The mint gate counts only fixes since THIS session's runtime start
  (PR #360 review) - the gpsData slice has no reset.
- Minting errors land in the panel's status line: `#error` is a sibling of
  `#ar-root` and invisible during the session (milestone review #4).
- `mintedCodeId` is cleared BEFORE the new hash starts (a second mint's
  download must not carry the previous code's name).

## Examples

```ts
const author = wireAuthorMode({ ctx, authorMode, arStore, seams, dom });
hooks.startAuthorPipeline = author.startAuthorPipeline;
```

## Tests

`playwright-tests/ar-mode.spec.js` - "author mode (?author=1) boots the
same foundation under its own labels" and "author mode mints and exports a
level that the parser round-trips" (the identity-matrix hole, the captured
size, the export). The pure pieces are unit-tested in `qr-author-mode.test.ts`
and the framework's `qr-mint-level` tests.
