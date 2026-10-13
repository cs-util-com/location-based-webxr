# poster-text.ts

## Purpose

The poster text a creator prints with the codes (polish round D-P7, r820
feedback R8): a title, an explanation and a call to action, filled in with
the owner's wording, editable in step 3 and remembered per tour link. The
PDF writer lays them out around every code (`qr-print-pdf.ts`, option
`poster`); the print panel shows them on its preview tiles.

## Public API

- `DEFAULT_EXPLANATION` = "AR tour starts here", `DEFAULT_CALL_TO_ACTION`
  = "Scan with your phone camera" - the owner's wording on r820 (the S1
  design's poster).
- `type PosterFields = { title, explanation, callToAction }` (strings).
- `defaultPosterFields(tourTitle)` - the tour's name (its `manifest.json`
  `title`, trimmed; empty when it has none) and the two defaults.
- `readPosterFields(store, link)` - what was stored for this tour link, or
  null: nothing stored, no store, a store that throws, or a value that is
  not an object of three strings.
- `writePosterFields(store, link, fields)` - stores under
  `tour-viewer.poster.<link>`; a throwing store is ignored.
- `type PosterTextStore` - `getItem` / `setItem` (`localStorage`).

## Invariants & assumptions

- **An emptied field stays empty** (D-P7: it is left off the poster). It is
  stored as "" and read back as "", never refilled with the default.
- **Keyed by the link as the print step holds it** - the same tour opened
  under another spelling of its link starts from the defaults.
- Site data blocked: the text lasts the page, nothing fails.

## Examples

```ts
const fields =
  readPosterFields(store, link) ?? defaultPosterFields(manifest?.title);
writePosterFields(store, link, { ...fields, explanation: "" });
```

## Tests

`poster-text.test.ts`: the defaults and the title, the per-link memory, an
emptied field kept empty, missing/throwing stores and damaged values, and
a round-trip property over any text. The panel's use of it is in
`print-panel.wiring.test.ts`.
