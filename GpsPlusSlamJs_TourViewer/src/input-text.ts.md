# input-text.ts

## Purpose

The one place a creator page's typed text becomes NFC (station blocks
plan design §3; B2a review finding 6). The tour format's reader does not
normalise; the pages do, where text is typed.

## Public API

- `inputText(value: string): string` - `value.normalize("NFC")`. Never
  throws for a string.

## Invariants & assumptions

- Called at each text input's commit on both creator pages: the phone's
  new pin (`creator-placement.ts`), a pin's edited text (`pinTextEdit`
  in `object-edits.ts`, both pages), the 3D editor's inspector fields
  (`editor/editor-shell/inspector-edits.ts`), the editor's details dialog
  (`editor/details-dialog.ts`).
- The pin counter counts the NFC text (`pin-text.ts`), so it counts what
  is stored.
- Idempotent: NFC of NFC text is the same text.

## Examples

```ts
inputText(`Cafe${String.fromCodePoint(0x301)}`); // "Café" in NFC, one code point shorter
```

## Tests

`input-text.test.ts` (decomposed to composed, idempotence property), and
at the sites: `object-edits.test.ts`, `pin-text.test.ts`,
`creator-setup.test.ts`, `editor/editor-shell/inspector-edits.test.ts`.
