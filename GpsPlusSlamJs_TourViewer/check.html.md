# `check.html` - the prototype-parity views, one per `?view=`

## Purpose

One standalone check page, linked from nothing, that draws one production
part at a time without an AR session, so it can be compared side by side
with the prototype it was built from, and so the layout e2e can pin where
its parts land. The view is chosen by the URL:
`check.html?view=<name>`; every other query key is the view's own (for
example `check.html?view=model-views&hook=1`).

It is a Vite build entry (`vite.config.ts`), so it is built and reachable
on a deployed branch preview at `/tour/check.html?view=<name>`; nothing in
the Tour Viewer imports it. It links the design system (`/design.css`) as
the app does, so a margin the design system zeroes shows here too.

The page holds the CSS every view shares (the full-page `#ar-root`, the
canvas, the visitor page's screen host `#narration-card-root` for then
and now, the model and character demos' view bar) and each view's
backdrop, keyed by `body[data-view]`. Its one script calls
`startCheckPage` of `src/checks/check-page.ts` (`check-page.ts.md`),
which loads only the chosen view's module. Without a known view the page
lists the views as links.

## The views

### `lectern` - a long text on its reading stand

Draws one long text in its `lectern` view on the production reading stand
in the narrated-text prototype's square
(`public/prototypes/station-blocks-1-narrated-text/`, opened at
`index.html#mode=visitor&view=lectern`). Code:
`src/checks/lectern-check.ts`, which documents the hook
`window.__lecternCheck`.

- Shows: the prototype's record (its title and first two paragraphs) on
  the stand, from the visitor's eye 2.6 m away. A click on the page turns
  it.
- Does not show: the camera image, the station's anchor and pose chain,
  the story, and the prototype's voice (the page following the narration,
  the word mark, the progress fill): the format has no narration for a
  long text yet.
- Tests: `playwright-tests/lectern-check.spec.js`;
  `src/checks/lectern-check.test.ts`.

### `long-text` - a long text in its reading sheet

Opens one long text in the production reading sheet over a painted
stand-in for the camera image (a sky, a row of houses, cobbles; page CSS
only, as the prototypes put a scene behind their boxes), to compare with
the narrated-text prototype
(`public/prototypes/station-blocks-1-narrated-text/`, opened at
`index.html#mode=visitor&view=silent` after walking into the station).
Code: `src/checks/long-text-check.ts`, which documents the hook
`window.__longTextCheck` and the view's own keys (`text=rich`, `ar=1`,
`voice=timed|stale`, `look=captions`, `open=0`).

- Shows: the prototype's record (its title and first two paragraphs) in
  the sheet, the reading mark on the first sentence. With `text=rich` a
  text with headings, a nested list, a link and two pictures; with `ar=1`
  a link asks before it opens, as during an AR session; with `voice=` a
  narrated text read along, and with `look=captions` the narration box in
  place of the sheet.
- Does not show: the camera image or the prototype's 3D square behind the
  sheet (the painted backdrop only stands in for one), the station's sign
  and the visitor's view switch; pictures only in the rich text.
- Tests: `playwright-tests/long-text-check.spec.js`,
  `playwright-tests/long-text-narration.spec.js`.

### `then-now` - then and now's Swipe

Shows one then-and-now picture with its production part
(`viewpointWorld`), seen from exactly its viewpoint, so the visitor's
slider is open at once and Swipe can be tried with a mouse on a desktop,
and so the e2e can drag the line and read the cut. Code:
`src/checks/then-now-check.ts`, which documents the hook
`window.__thenNowCheck`. The page copies the visitor page's screen host
rules (`#narration-card-root`), so the panel sits where it sits there.
The view installs the page-wide slider guard (`check-page.ts.md`), as
every page with a slider does.

- Shows: "Today" as a plain blue backdrop and the old picture as a red
  one with a light grid. Choose Swipe in the panel and drag the round
  knob: red stays left of the line, blue right of it.
- Does not show: the camera image, walking up to the spot (the eye is on
  it from the start), the spot guide on the way in, and the AR session's
  gestures.
- Tests: `playwright-tests/then-now-check.spec.js`.

### `travelling-box` - a narrated text's words under its sign

Shows one narrated long text's reading sign with its words painted on a
plate under it, as the travelling box prototype
(`public/prototypes/sign-speaks-r6-2-travelling-box/`) draws it. Code:
`src/checks/travelling-box-check.ts`, which documents the hook
`window.__travellingBoxCheck`.

- Shows: the prototype's weighing house text on the app's reading sign,
  its words on the plate under it, from the visitor's eye 3 m away. The
  voice stands still until the hook moves it.
- Does not show: the camera image, the station and its pose chain, and a
  real voice (the hook moves a clocked one). The taps, drags, the flight to
  the bottom of the screen and back, and the hiding are shown and tested
  here. The app's own travel wiring (the follow, the registry, the camera)
  is a phone test: no AR spec travels the words (headless has no camera to
  project through; the AR specs cover the words at the bottom only).
- Tests: `playwright-tests/travelling-box-check.spec.js`.

### `model-views` - a tour model in each world view

Draws one tour model in one of its world views (`placed`, `ghost`,
`hotspots`, `cutaway`, `toy`) with the visitor's notes, card and toy
gestures, in a plain daylight scene (the views' prototype's sky, fog,
room light, hemisphere and sun, on a flat ground), to compare with
`public/prototypes/station-blocks-5-models/`. Code:
`src/checks/model-views-check.ts`; the view also loads
`src/model-visitor.css`.

Two modes:

- **Demo, for a person** (no `hook`): the stand-in model in the
  `hotspots` view, with three notes, two named sections and its clip
  `swing`, framed for a phone; a drag orbits it (not in `toy`, whose card
  takes the drags); a bar of buttons at the top (Placed, Ghost, Hotspots,
  Cutaway, Toy, the shown one pressed) switches the view.
- **Hook, for tests** (`hook=1`): an empty scene, drawn on only through
  the hook below. The layout e2e opens the view this way.

The hook `window.__modelViewsCheck` (installed in both modes):

- `load(glbBase64 | null)` - the `.glb` to draw from now on; null (the
  default) draws a stand-in: a 2 m post with an arm and a clip "swing".
- `show(block)` - draw the model as a model block in a world view says
  (`id`, `kind: "model"`, `view`, `sizeM`, `pose`, and any notes,
  sections or clip). The model is placed directly at `pose` in the page's
  scene (y up), sized by the shared `modelScale` and mounted by
  `mountModelView`, as the visitor's renderer does.
- `lookFrom(eye, target)` - stand the camera at `eye` and look at
  `target` (metres).
- `openNote(i)` - open the shown model's note `i`.
- `state()` - the shown view, the card (hidden, counter, title) and the
  number of discs on screen.

A click on the canvas is a visitor's tap (`createModelVisitor.tapped`).

- Does not show: the camera image (a plain ground stands in for it), the
  station's anchor and pose chain (the model's pose is used directly) and
  the story.
- Tests: `playwright-tests/model-views.spec.js` (the layout of the card
  and the discs at a phone, a phone held sideways and a desktop, in hook
  mode; the demo's bar and its views on a phone);
  `src/checks/model-views-check.test.ts` (the block check and the field of
  view).

### `character-views` - a tour character in each world view

Stands one tour character (the station-blocks-7 prototype's knight,
Wendel the Warden) in one of his world views (`bubble`, `speak`,
`two-stations`, `portrait`, `popup`) as `src/character-look.ts` draws
him, in a plain daylight scene with the prototype's numbers, to compare
with `public/prototypes/station-blocks-7-character/`. Code:
`src/checks/character-views-check.ts`.

Its figure is the knight's frames sheet
`public/checks/character-knight-sheet.webp` (2048 x 1024, WebP at quality
0.85): the prototype's own procedural `drawKnight`
(`public/prototypes/station-blocks-7-character/index.html`, the code from
`const FW = 512` to `function silhouette`) drawn into four 512 x 1024
cells as its frames 0, 2, 1, 3 - idle, talk-a (half open), talk-b (open),
beckon - because the prototype numbers its mouth frames the other way
round (its 1 is open, its 2 half). One change to that code: the
prototype's half-open frame also raises his sword arm, so its arm branch
(`} else if (half) {`) is skipped and talk-a keeps the idle arm - a
frames sheet's talking cells differ from idle in the head alone.
Re-rendered 2026-10-29 for that: below the head band (rows 340 to 1023 of
each cell) cells 0 to 2 now share one alpha mask at every alpha threshold
tried (0, 16, 128, 250), where the earlier sheet's cell 1 differed from
idle by about 4 100 pixels. Rendered once in a headless Chromium
(Playwright) with `canvas.toDataURL("image/webp", 0.85)`; to re-render,
run that code in a page the same way. It replaced `character-knight.webp`
(frame 0 alone).

Two modes:

- **Demo, for a person** (no `hook`): a bar of buttons at the top
  switches the view; `two-stations` beckons toward the page's second
  station and `portrait` speaks.
- **Hook, for tests** (`hook=1`): no bar; the page is driven through
  `window.__characterViewsCheck` (installed in both modes; see
  `src/checks/character-views-check.ts.md`).

Not copied from the prototype: its surroundings (the walls, the paving,
the other station's props) and its DOM portrait card: the build shows the
portrait in the walk card (`#scene-portrait` in `index.html`), not on
this page.

- Tests: `playwright-tests/character-views.spec.js`.

## The old pages

Each view used to be its own page; those pages were removed and are in git
history. An old link maps to the new one like this (every other query key
carries over unchanged):

- `lectern-check.html` - `check.html?view=lectern`
- `long-text-check.html` - `check.html?view=long-text`, with its old
  `view=captions` now `look=captions` (for example
  `long-text-check.html?voice=timed&view=captions` is
  `check.html?view=long-text&voice=timed&look=captions`)
- `then-now-check.html` - `check.html?view=then-now`
- `travelling-box-check.html` - `check.html?view=travelling-box`
- `model-views-check.html` - `check.html?view=model-views`
- `character-views-check.html` - `check.html?view=character-views`
- `narration-look-check.html`, `file-access-check.html` and
  `write-probe.html` have no view: they were removed with the others.

## Tests

The view parse and the index: `src/checks/check-page.test.ts`. Each view's
tests are listed in its section above.
