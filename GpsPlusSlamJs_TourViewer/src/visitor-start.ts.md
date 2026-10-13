# visitor-start.ts

## Purpose

What the visitor's start page shows about the tour, in the owner's chosen
prototype V4 (polish round M4a, D-R12; one cover photo, D-R14): the tour's
name large, one line under it, and one of its photos. A pure view function
plus a small wiring that writes the page and loads the photo from the zip.

## Public API

- `visitorStartView(manifest: TourManifest | null): VisitorStartView` -
  pure.
  - `title`: the manifest's `title`, trimmed; `"An AR tour"` when it has
    none, an empty one, or no manifest yet.
  - `subline`: `"N places to discover"` (`"1 place …"`): a tour of
    stations counts its stations (the objects they show are not places of
    their own); any other tour its objects and baked capture spots; `null`
    when there are none.
  - `coverPath`: the first placed `photo` object's `image`, else the first
    capture spot's `image` (a tour made from a recording), else `null`.
- `wireVisitorStart({ dom, createObjectUrl, revokeObjectUrl, checkPicture }): VisitorStart`
  - `dom`: `title`, `subline`, `cover` (the figure, hidden without a
    photo), `coverImage` (decorative, `alt=""` in the markup: the title
    names the tour). Structural types, so the node unit tests pass plain
    objects.
  - `present(manifest, loadImage)` writes the name and the subline at
    once, then reads the cover by its archive path through `loadImage`,
    checks it with `checkPicture` (the page's `pictureProblem`) and shows
    it through an object URL.
  - `clear()` - the defaults, no photo, the object URL released.

## Invariants & assumptions

- **Only the tour's own photos can be the cover:** the path always comes
  from a photo object or a capture spot, never from anything else the zip
  holds (a property test over pins, photos and capture spots pins the
  choice: the first own photo, placed photos first).
- **A newer tour wins:** each `present` / `clear` bumps a generation; a
  cover that finishes loading for an older tour is dropped (checked both
  after the read and after the picture check).
- **No leaked object URLs:** the previous cover's URL is revoked on every
  `present` and `clear`.
- **A photo that cannot be read or fails the check shows no cover**; the
  page stays usable, the error is swallowed on purpose (the name and the
  button matter, the photo is decoration).
- Only wired for a visitor (`main.ts`); a creator never sees the page and
  never pays for the photo read.
- The manifest's title is written at the creator's Finish from the step-3
  poster title (`creator-finish.ts`, `finishTitle`).

## Examples

```ts
const start = wireVisitorStart({
  dom: { title, subline, cover, coverImage },
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  checkPicture: pictureProblem,
});
hooks.presentTourInfo = (manifest, loadImage) =>
  manifest === null ? start.clear() : start.present(manifest, loadImage);
```

## Tests

- `visitor-start.test.ts` - the view (name, fallback, counts including
  stations and capture spots, cover choice, a property test that the cover
  is always a photo's own image) and the wiring (cover shown after load,
  rejected by the picture check, a newer tour's cover kept over an older
  one's, clear releases the URL).
- `playwright-tests/visitor-start.spec.js` - the real page: the sample
  tour's name and subline, the layout at three viewports, and a baked
  tour's cover loading from the zip.
