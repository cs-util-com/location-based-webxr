# landing/landing-cards.ts (and landing-cards.css)

## Purpose

The landing's step cards in the page: draws the drawn phone into each
card's dock, frames each phone's screen on its part of the drawn place,
and lets `card-play.ts` decide which picture moves. Loaded by
`landing-mount.ts` with `import()`, for a creator only.

## Public API

- `mountLandingCards(root, { reducedMotion, filmHost? }): { destroy() }`
  - `root` holds the cards (`.landing-card`), each with an empty dock
    (`.lc-dock[data-kind]`) inside a box whose height the page reserves
    (`.landing-pic`), and, for the four animated cards, a pause button over
    the picture (`.landing-hold`, `aria-pressed`) and "Show again"
    (`.landing-again`). The pause is authored `hidden`; "Show again" has no
    `data-ready` yet, so the page's CSS keeps it invisible but in the layout
    (the caption does not grow when it appears).
  - `data-kind="scene"` (the first card) gets the place itself with the old
    photo and a note; it never moves. `place`, `add`, `hang` and `scan` get
    a phone.
  - Marks "Show again" `data-ready`, and reveals the pause button unless
    `reducedMotion`.
  - Writes the controller's state onto each dock: `data-phase`
    (`still`/`playing`/`holding`), `data-paused`, and the class `lc-play`
    (removed and added again on a new run, so the CSS sequence restarts
    from its first frame). `aria-pressed` follows the pause.
  - Blocked (no picture moves by itself) while `filmHost` carries
    `data-playing="true"` or the tab is hidden.
  - `destroy()` stops the controller and the observers, empties the docks,
    hides the pause, unmarks "Show again" and removes the shared drawing
    (which sits beside the list, not in it: the list holds only its cards).
- `shareInView(ratio, viewportHeight, pictureHeight)` - the controller's
  share: the intersection ratio divided by `min(1, viewport / picture)`,
  clamped to [0, 1]; 0 for sizes that are not positive.
- `CARD_DURATIONS_MS` - each sequence's length, as the CSS times it: place
  2000, add 3300, hang 2600, scan 2600 ms.

## The stylesheet

- `landing-cards.css`, bundled into this chunk; every class, id and
  keyframe is prefixed `lc-`. It relies on the page for `--pw` (the phone's
  width, set per viewport on `.landing-fig`) and defines its own colour
  tokens (`--lc-*`, the prototype's values).
- Each dock shows its final frame without `.lc-play`; with it, its short
  sequence runs once from the first frame (`animation-fill-mode: both`).
  `data-paused="true"` sets `animation-play-state: paused` on everything in
  the dock. The title of the `add` card is typed letter by letter
  (`lc-type`, one step per letter at 65 ms, from 585 ms).
- Not linted by the package's `lint:css` stage (it lints `**/*.html`), so
  it may use `min()`; the page's own CSS in `index.html` may not.

## Invariants & assumptions

- Frames are computed as the prototype's `layout()`: a screen shows 440
  world units across, keeps the band 250 to 760 in view, centred on the
  dock's `data-look`; the place behind the phone is offset to match, and
  the AR content is pinned at `data-wx`/`data-wy`. Recomputed on a resize
  (`ResizeObserver`, where present).
- Without `IntersectionObserver` nothing moves by itself; "Show again"
  still plays.
- The pictures are decorative (`aria-hidden` docks); each card's text and
  caption carry the meaning. The pause button is labelled "Pause the
  picture".

## Examples

```ts
const cards = mountLandingCards(document.querySelector(".landing-cards")!, {
  reducedMotion: false,
  filmHost: document.getElementById("landing-film"),
});
cards.destroy();
```

## Tests

- `landing-cards.test.ts` (jsdom) - `shareInView` cases and a property; the
  drawing's ids and references; a mount draws the phones and the scene;
  the picture in view starts after the settle delay and pauses on a tap;
  the film blocks; reduced motion hides the pause and keeps "Show again";
  no IntersectionObserver keeps everything still; destroy.
- `playwright-tests/landing.spec.js` - in a browser: a picture plays,
  pauses, plays again on "Show again", and stays still under reduced
  motion; the layout at three viewports.
