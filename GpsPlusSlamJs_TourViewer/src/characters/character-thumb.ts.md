# character-thumb.ts

## Purpose

A character's list thumbnail and its "made today, 14:05" line, shared by the
character maker's library (`maker-main.ts`) and the tour editor's Characters
list (`../editor/characters-panel.ts`), so both lists show a character the
same way.

## Public API

- `cropThumb(blob: Blob): Promise<string>` - the head and upper body of the
  figure in `blob` (its opaque pixels, sampled every second pixel), drawn
  into a 112 x 144 PNG and returned as a data URL. A picture with no opaque
  pixel gives an empty (transparent) 112 x 144 picture; a canvas without a
  2D context gives `""`. A picture the browser cannot decode rejects
  (`createImageBitmap`); callers show the row without a thumbnail.
- `whenMade(iso: string, now = new Date()): string` - "made today, HH:MM"
  (24-hour, en-GB) for the same calendar day within 24 hours, "made
  yesterday" under two days, else "made N days ago".

## Invariants and assumptions

- Browser only: it needs `createImageBitmap` and a canvas.
- The crop is 62 % of the figure's height from 5 % above its top, at the
  thumbnail's 112:144 aspect, centred on the figure.

## Examples

```ts
img.src = await cropThumb(files.image);
meta.textContent = whenMade(record.createdAtIso);
```

## Tests

- `character-thumb.test.ts` - `whenMade` against fixed clocks (today,
  yesterday, days ago). `cropThumb` needs a real canvas and is seen in the
  maker's and the editor's browser tests (the list rows show a thumbnail).
