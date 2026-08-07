# `header-collapse.ts`

## Purpose

Makes the header collapsible by tapping its title, and guarantees an error can
never be reported into a hidden status line.

## Public API

- `attachHeaderCollapse({ header, toggle, onToggle }): HeaderCollapse`
  - `set(collapsed)` — no-ops if unchanged, so `onToggle` never fires spuriously.
  - `collapsed` — current state.
  - `revealForError()` — expands if collapsed. Called on every error dispatch.
  - `dispose()` — removes both listeners.

State lives in `header[data-collapsed]`, so the CSS, the tests and
`aria-expanded` all read one source.

## Invariants & assumptions

- **The header is a grid ROW, not an overlay.** `body` is
  `grid-template-rows: auto 1fr`, so its wrapped lines are taken **out of** the 3D
  view's height rather than covering it. The round-2 feedback assumed the
  opposite; the correction is what makes collapsing worth doing — it hands back
  viewport. Making it an overlay too is a separate change and was not taken.
- **`onToggle` must resize both canvases.** Neither Leaflet nor the WebGL renderer
  notices a container that resized without a window event, and the 3D view renders
  on demand — so a resize without a scheduled frame leaves it blank (finding R2-3).
  `BuildingView.resize()` schedules its own frame, so calling it suffices. It also
  fires **once on attach**, so a caller can size everything through one path.
- **A no-op `set` does not call `onToggle`.** `revealForError()` runs on every
  error, and a resize-plus-repaint per error message would be visible churn on a
  failing network.
- **Errors expand the header and it STAYS expanded (DEC-R2-15).** The status line
  lives inside the header and every reporter — fetch, either view, the locate
  button, a dead worker — writes there. Auto-collapsing again would race the user
  reading it. This keeps one error channel rather than growing a second.
- **What stays visible when collapsed (DEC-R2-4, redrawn by DEC-R6b-5):** title,
  category picker, legend, and the whole **affordance** group — which since
  round 7 includes the `show-below` checkbox. The legend NAMES the current
  category (round-1 DEC-1) and describes the affordance layers, so hiding either
  the picker or those switches would leave the collapsed bar making a claim with
  no way to act on it.
- **What collapses:** the hint, the status string, and the **World**, **Debug**
  and **Ground** controls. Before round 7 exactly one setting collapsed —
  `show-below` — while those three stayed, which is backwards from what the bar
  is for and is what the sixth session reported.
- **The ground picker collapses, and that reversed an earlier rationale
  (Q-R6b-3).** `index.html` used to call the ground surface one of "the two
  primary inputs" alongside the category picker. The owner chose the session's
  note over that wording, so the comment was reworded rather than left
  describing a rule the code no longer follows: the category picker stays
  because the legend names the category, and the ground mode is not in that
  relationship with anything in the collapsed bar.
- **Nothing here implements any of that** — `header-collapse.ts` sets
  `data-collapsed` and stops. Every decision about what disappears is CSS in
  `index.html`, and the assertions live in the e2e suite, because jsdom does not
  apply that stylesheet.
- **Attribution is never collapsed away.** The Terrarium credit moved into
  Leaflet's attribution control (`MapView.setTerrainAttribution`), which is always
  visible. The header span was REMOVED rather than kept as a mirror: two copies of
  one credit is one too many, and the header copy is the one that disappears on
  collapse — i.e. the copy that does not satisfy the obligation, sitting beside the
  one that does.
- **The toggle is an `<h1>` given `role="button"` + `tabindex="0"`, so Enter and
  Space are implemented by hand.** A real `<button>` gets them free; `role` only
  _promises_ them. Space also has `preventDefault()` or it scrolls the page out
  from under the tap.

## Examples

```ts
const collapse = attachHeaderCollapse({
  header: el("header-bar"),
  toggle: el("header-toggle"),
  onToggle: () => {
    mapView.map.invalidateSize();
    buildingView.resize();
  },
});
// wired to the store, so any reporter reaches the user:
if (loading.phase === "error") collapse.revealForError();
```

## Tests

`header-collapse.test.ts` — 9 examples, and **the only file in this project that
opts into jsdom** (`@vitest-environment jsdom`, per-file so the other ~165 unit
tests keep running with no environment). The house pattern is to extract pure
decisions and leave DOM wiring to e2e, but here the wiring _is_ the behaviour worth
pinning: which attributes move together, that a no-op does not fire a resize, and
that Enter/Space actually work.

Three e2e cover what only a browser shows: that collapsing transfers height to the
3D view (asserted as a height change, not visibility), that a **real** refused
geolocation permission expands the bar, and that the attribution survives a
collapse.
