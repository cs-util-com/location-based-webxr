# long-text-pictures.ts

## Purpose

Holds a long text's pictures to a decode budget. Each picture waits in the
holder `long-text-render.ts` made, showing its alt text. Once it comes
within a screen of the view its file is read and measured from its header
(`image-cap.ts` `pictureFit`); it is shown while it stays near and the
pictures shown together stay within `LONG_TEXT_DECODE_BUDGET_PX`, and let
go (URL revoked, alt text back) two screens away. A long text with 20
large pictures therefore never holds more decoded pixels than a phone can
afford, which matters most in AR, where a page reload loses the visitor's
place.

Design: `GpsPlusSlamJs_Docs/docs/2026-10-25-2052-station-blocks-build-plan.md`
(B3a step 1).

## Public API

- `LONG_TEXT_DECODE_BUDGET_PX = 24_000_000` - what it rests on and what
  would reverse it are in its doc comment; the 16/24/48 MP sweep is in the
  build plan's "B3a built" section.
- `screensAway(box, view)` - the gap between two vertical spans in view
  heights; 0 where they overlap; `Infinity` for a view with no height.
- `planPictures(entries, budget)` - pure. `entries[i]` is
  `{ pixels | null, screensAway, shown }`; returns `{ show, release }`
  (index sets).
  - A shown picture under 2 screens stays (and counts first against the
    budget); at 2 or more it is released.
  - A measured, not shown picture within 1 screen is admitted, nearest
    first, while the total fits; one that does not fit is skipped and a
    smaller, farther one may still be admitted.
- `createLongTextPictures(deps)` - the controller; `update()` on every
  scroll or open, `dispose()` on close.
  - `deps`: `pictures` (the render's slots), `document`, `load(asset)`,
    `fit(blob)`, `screensAway(holder)`, `createUrl`, `revokeUrl`, an
    optional `budget`.
  - A picture over the tour cap shows "<alt> (too large to show here)"; one
    whose size cannot be read, whose load fails or whose fit throws shows
    "<alt> (cannot be shown here)". An empty alt reads "picture".
  - A shown picture is an `img` with `src` (the object URL) and `alt` only,
    inside the `LONG_TEXT_ALLOWED` list.

## Invariants & assumptions

- The planned pixels never exceed the budget, nothing is shown at 2
  screens or more, and nothing near is let go (the property test).
- The blob read for measuring is kept only until the next plan: used for
  the URL if admitted at once, dropped otherwise; a later admission reads
  the file again. A picture being fetched holds its place in the budget.
- Every URL made is revoked on release or dispose; a load that settles
  after `dispose()` changes nothing.
- A single picture is never larger than the budget: the tour cap (16.7 MP)
  is below 24 MP. A budget set below the cap would leave such a picture as
  its alt text, never over budget.
- Never throws into the page: every async path ends in a state.

## Examples

```ts
const rendered = renderLongText(doc, { document, onLinkTap });
body.replaceChildren(rendered.fragment);
const pictures = createLongTextPictures({
  pictures: rendered.pictures,
  document,
  load: (asset) => readAsset(asset),
  fit: pictureFit,
  screensAway: (holder) =>
    screensAway(
      holder.getBoundingClientRect(),
      scroller.getBoundingClientRect(),
    ),
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
});
scroller.addEventListener("scroll", () => pictures.update(), { passive: true });
pictures.update();
```

## Tests

- `long-text-pictures.test.ts` - `screensAway`, the planner's rules, and
  the controller: near shown, far left as alt, release revokes, the two
  failure texts, a full budget then room, dispose, a throwing fit.
- `long-text-pictures.property.test.ts` - the plan's invariants over
  generated sizes and distances.
- Scratch mutants (release at 3 screens, admit at 1.5, a budget check
  without the new picture, no revoke on release) each fail the suite.
