# visitor-start.ts

## Purpose

What the visitor's start page shows about the tour, in the owner's chosen
prototype V4 (polish round M4a, D-R12; one cover photo, D-R14): the tour's
name large, one line under it, and one of its photos. A pure view function
plus a small wiring that writes the page and loads the photo from the zip.

## Public API

- `visitorStartView(manifest: TourManifest | null): VisitorStartView` -
  pure.
  - `manifest` is the open tour's `tour.json`, null for a zip without
    one.
  - `title`: the manifest's `title`, trimmed; `"An AR tour"` when it has
    none, an empty one, or no manifest.
  - `subline`: `"N places to discover"` (`"1 place …"`): the tour's
    stations (the pins and photos they hold are not places of their own; since version 3 every one of them is in a
    station). `"This tour is not finished yet."`
    for a tour that is not (`tour-unfinished.ts`: no `tour.json`, or no
    station): the printed code may point at the hosted file before its
    first Finish, and that is said plainly, not as an error.
  - `description`: the manifest's `description` (W2 of the tour editor
    plan 2026-10-17-1816), trimmed; `null` for none.
  - `coverPath`: the cover the creator chose (`cover`, W2; its entry by
    the framework's `tourCoverEntry`), else the first placed photo's
    `image` (in station order, `tourItems`), else `null`. Never a debug
    camera capture: a visitor never sees one.
  - `pageTitle`: the tab's title, which a shared link's title shows too:
    the tour's name, else "Tour Viewer".
- `wireVisitorStart({ dom, createObjectUrl, revokeObjectUrl, checkPicture }): VisitorStart`
  - `dom`: `title`, `subline`, `description` (hidden without one),
    `page` (the document, for its `title`), `cover` (the figure, hidden without a
    photo), `coverImage` (decorative, `alt=""` in the markup: the title
    names the tour). Structural types, so the node unit tests pass plain
    objects.
  - `present(manifest, loadImage)` writes the name and the subline at
    once, then reads the cover by its archive path through `loadImage`,
    checks it with `checkPicture` (the page's `pictureProblem`) and shows
    it through an object URL.
  - `clear()` - no tour open: the defaults (no subline), no photo, the
    object URL released.

## Invariants & assumptions

- **Only the tour's own images can be the cover:** the path always comes
  from a photo object or an image asset the tour names as its cover, never
  from anything else the zip holds, its debug camera captures included (a
  property test over pins, photos, capture spots and chosen covers - a
  photo, a pin, an unknown id - pins the choice: the chosen photo, else the
  first placed photo).
- **Open-graph previews are not covered:** a crawler reads the static
  `<title>` of `index.html` and runs no script, so a shared link's
  preview card still says "Tour Viewer"; the tab's title (and a link
  copied from it) says the tour's name.
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
- The manifest's title is written at the creator's Finish from step 3's
  "Tour name" field (`tour-name-field.ts`; `finish-rebuild.ts`
  `finishTitle`), or in the desktop editor's details dialog.

## Examples

```ts
const start = wireVisitorStart({
  dom: { title, subline, cover, coverImage },
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  checkPicture: pictureProblem,
});
hooks.presentTourInfo = (tour) =>
  tour === null ? start.clear() : start.present(tour.manifest, tour.loadImage);
```

## Tests

- `visitor-start.test.ts` - the view (name, fallback, the unfinished
  sentence for no `tour.json` and for no station, counts of stations, cover
  choice and the chosen cover, no cover from a debug camera capture, the
  description, the page title, a property test that the cover is always a
  photo's own image) and the wiring (description, page title, cover shown after load,
  rejected by the picture check, a newer tour's cover kept over an older
  one's, clear releases the URL).
- `playwright-tests/visitor-start.spec.js` - the real page: the sample
  tour's name and subline, the layout at three viewports, a baked
  tour's cover loading from the zip, and the details tour (its chosen
  cover, description, page title and contact under an error), a tour
  without stations (its start page says it is not finished, with its
  contact) and a zip without `tour.json` (the same sentence, no contact).
