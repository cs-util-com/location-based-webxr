# travel-surface.ts

## Purpose

The contract between a travelling surface and the travelling box's
controller (`travelling-box.ts`). A surface is one painted texture that is
drawn either on a plate in the world or on a quad that flies to a dock at
the screen's foot, plus an invisible DOM ghost that lays it out at the
dock and takes the fingers there. The controller knows nothing of words,
voices or signs: everything it needs from the thing that travels goes
through this interface. The reading sign's words are the first surface
(`travelling-box-sign.ts`).

Types only: this file has no runtime code.

## Public API

- `TravelSlot`: `"bottom" | "corner"`, the screen slot the surface docks in. Module-private: the interface fields use it.
- `TravelKind`: `"words" | "bubble" | "video" | "note" | "pin"`. Module-private, as above.
- `TravelRect`: `{ x, y, w, h }` on the page, CSS px.
- `TravelLayout`: `{ cssW, cssH, fontPx, lineHeightPx, canvasW, canvasH }`,
  the ghost's size, one em and one line of its text (CSS px), and the
  canvas size it paints into (device px).
- `TravelPress`: `{ id, x, y, linePx }`, a finger forwarded from the plate
  or the quad, in page px, with one line of the text as the finger sees it.
- `TravelSurface`:
  - identity: `id` (unique per open surface; logs and the check hook carry
    it), `kind`, `slot`, `voiced`, `answersTo()` (the voice it answers to, or null);
  - `plate`: a unit plane mesh (x and y from -0.5 to 0.5, facing +z) the
    surface scales and places; its material's `map` and `opacity` belong
    to the controller while it hangs;
  - the place inputs: `travelling()`, `hideWhy()`, `canFold()`,
    `gates(metrics, knobs)`;
  - painting: `layout()`, `paintKey()`, `paint(g)`, `hang(texture, layout)`,
    `unhang()`;
  - the ghost: `restingRect()`, `setGhost(on)`, `setPointer(on)`;
  - fingers: `beginPress(press)` (false while one is down),
    `movePress(x, y)`, `endPress(kind, x, y)`, `pressing()`.

## Invariants and assumptions

- `layout()` returns the same object until the surface lays out anew; the
  controller sizes the canvas and hangs the plate again only when the
  object changes. It is called once per frame, before `paintKey` and
  `paint`.
- `paintKey()` changes whenever a paint would look different; the
  controller paints only on a change.
- `restingRect()` comes from the ghost's layout, never from a per-frame
  `getBoundingClientRect`.
- A surface validates its own inputs (the sign's adapter refuses a words
  plate that is not a mesh); the controller trusts the contract.

## Examples

See `travelling-box-sign.ts` for the words; a new kind implements the same
interface and is handed to `createTravellingBox({ surface, ... })`.

## Tests

None of its own (types only). `travelling-box.test.ts` drives the
controller through a fake surface, and `travelling-box-sign.test.ts` the
words' adapter.
