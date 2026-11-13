# `layer-toggles.ts`

## Purpose

The layer switches, generated from the registry: every group a folded
section of the settings drawer, and the `cells` switch in the command bar.

## Public API

- `attachLayerToggles({ container, onChange, bar?, extrasBefore?, extrasAfter?, sectionsBefore? }): LayerToggles`
  - `bar`: where the bar's switches go (`BAR_LAYERS`, today only `cells`,
    beside the category picker it draws). Its change listener is added and
    removed with the container's.
  - `sectionsBefore`: whole sections handed over by the page, placed before a
    group's section (the sun section before "View and debug").
  - `render(layers)` — brings the switches in line with the store; safe on every
    change.
  - `dispose()` — removes the one delegated listener.

Each input gets `id="layer-<kind>"` and `data-layer`, so a test can address one
switch without depending on DOM order.

## Invariants & assumptions

- **The switches are GROUPED into affordance / world / debug (W15).** Nine of
  them in one wrapping row is the pile the round-3 notes called prototypical, and
  the grouping is not decoration: the three groups answer three different
  questions — what is the affordance analysis claiming, what is in the world, and
  what am I inspecting the renderer with.
- **Every group is a FOLDED drawer section**, in the order Analysis, World,
  City look, (the page's Sun and time), View and debug. Each is a native
  `<details>` without `open`, so the browser does the folding; open/closed is
  view state, never stored. The sections are inside the container, so the one
  delegated `change` listener still sees their switches. The e2e suite opens
  the drawer and a section through `setting()` in `playwright-tests/fixtures.js`.
- **`cells` lives in the bar** (`BAR_LAYERS`), next to the category picker,
  because it is the switch the demo is used for; it keeps `#layer-cells` and
  its busy cue (`setBusy` marks the bar label).
- **History: "City look" was the first folded group.** It holds the furniture
  switch, and `main.ts` hands it the colour scheme, invented roofs and zebras
  through the same extras seam. It is a native `<details>` without `open`,
  captioned by a `<summary class="layer-group-label">`, so the browser does the
  folding (`FOLDED_GROUPS`); the other groups stay `<div>` boxes with a `<span>`
  caption. Not remembered across reloads, like the header collapse. Why folded:
  these are long-term choices, and spread through the header they wrapped the
  world group onto a second row at 1280 px, which took height from the canvas.
  The section is inside the container, so the one delegated `change` listener
  still sees its switch. The e2e suite opens the drawer and unfolds the section through `setting` in
  `playwright-tests/fixtures.js`.
- **THE IDS ARE THE CONTRACT.** Every switch keeps `#layer-<name>`; the e2e suite
  locates them that way, so the regrouping moved elements without renaming any.
- **`extrasBefore` / `extrasAfter` put a non-layer control in a group**, above
  or below its generated switches. Four controls use them since J2 — see "the
  ground picker" below. The perf panel is a
  diagnostic and is the only member of that group, but it draws nothing in the
  scene so it is deliberately not in `ALL_LAYERS` (DEC-R3-18). The `show-below`
  checkbox joins the **overlays** group (DEC-R6b-5): it is not a layer either —
  it changes which cells an existing layer draws — but it is a property of the
  affordance heat grid and belongs with its switches, underneath them. The
  category `<select>` used to join the same group above them; it is in the
  command bar now. Handing the element
  in beats a second registry or moving DOM after the fact.
  - **The position is in the option name because a comment is not a test**
    (round three, G2/F7). There used to be a single `extras` record that always
    appended, while `main.ts` asserted in prose that the category picker sat
    first. It rendered last, and this file had no `extras` assertion of any
    kind, so nothing contradicted the comment. Callers now have to say where,
    and `layer-toggles.test.ts` holds each position to the screen.
  - **Group membership is load-bearing, not cosmetic.** A section folds as a
    whole, so being a real child of `#layer-group-overlays` is what makes
    `show-below` fold and unfold with its switches. A sibling styled to look
    adjacent would render identically and behave wrongly.

- **Generated from `ALL_LAYERS`, never hand-written.** A hand-written row is a second
  list of layers, and the two drift the moment a builder is added — leaving a layer
  that renders but cannot be switched off, which is the exact state the registry
  exists to prevent. Generating them carries the compiler's exhaustiveness over
  `LayerKind` into the UI.
- **`onChange` reports a WHOLE set, not one changed layer.** The store's action
  replaces the set (see `osm-view-slice.ts` for the publish-boundary reason), and
  `toggleLayer` is the only thing that knows how to build a valid one. This file does
  DOM, not state arithmetic.
- **`render` only writes `checked` when it differs.** Re-rendering from the store must
  never be able to fire `change` and dispatch again — that is a feedback loop, and a
  subtle one to diagnose.
- **One delegated listener, held for `dispose()`.** Seven listeners would be seven
  things to remove, and an anonymous one cannot be removed at all.

## Examples

```ts
const toggles = attachLayerToggles({
  container: el("layers"),
  // DISPATCH ONLY. Whether the change also needs new DATA is decided by the
  // `view.layers` store subscriber, which sees every dispatch and is handed
  // `(current, previous)` -- see `layersNeedingData` in `layers.ts.md`. Deciding it
  // here would work only while this is the sole dispatcher.
  onChange: (next) => store.dispatch(actions.layersChanged(next)),
});
toggles.render(selectLayers(store.getState()));
```

## Tests

The pure decisions live in `layers.test.ts`.

**The switch inventory this module BUILDS is unit-tested** in
`layer-toggles.test.ts` (jsdom): one switch per `ALL_LAYERS` entry, each
addressable as `#layer-<id>`, each id unique, each inside a `layer-group-*` box.
It is checked against the **registry**, not against the DOM's internal
consistency, so a layer added without a switch fails here rather than being
noticed on screen. Four mutations of this file each kill at least one of them —
renaming the id template, dropping a layer from the loop, giving every switch the
same id, and unnaming the group box.

- **`#layer-<id>` is a published contract**, and this is what makes it one: the
  Playwright suite addresses every switch that way, so the grouping work had to
  move the elements without renaming any. A contract with no test is a comment.
- **Visibility is deliberately NOT asserted here.** Whether a switch is on screen
  is CSS resolving against real layout (the drawer, folded sections and the
  phone media queries), which jsdom does not do. That assertion
  stays in `boot-and-shell.spec.js`, which keeps only the browser-only half.

The wiring is covered by two e2e:
_"switch geometry off and on without refetching"_ (asserts through the status line's
own counters that the layer is not BUILT, and that no Overpass request is made — a
presentation change must not refetch -- TRUE OF EVERY LAYER EXCEPT `cells`, which
since round 10 stage B is not sent while it is off and therefore refetches when
switched on -- UNLESS the array is still held from before it was switched off,
which the `view.layers` subscriber checks via `layersNeedingData`; see
`layers.ts.md`) and _"switching the cells layer off clears the
grid in BOTH views"_ (the registry has to reach the map as well as the scene, or one
view keeps drawing what the store says is off).

## The ground picker joins `world` (J2, DEC-J5 — 2026-08-22)

`#ground-mode-label` was a loose `<label>` sitting as a direct child of the
header. J2 put every header control into a rounded block and made the bar itself
fully transparent, which left this one control as the only bare thing on screen —
i.e. the next session's finding. `main.ts` now hands it over as an
`extrasAfter.world` extra.

**`world` rather than a block of its own.** That group answers "what is in the
world", and the ground mode chooses which surface is drawn as the ground. It is
still deliberately **not** a layer: `ALL_LAYERS` means things drawn
independently, and this is one thing drawn three ways, exclusively — which is
exactly why it needs the extras seam rather than the registry.

**`layer-toggles.test.ts` used `world` as its "group nobody named" control and
said so in prose**, on the grounds that `world` carries no extra in production.
That stopped being true here. The test never depended on it — it builds its own
options — but the comment did, and it has been corrected rather than left to be
trusted. Cold review caught it in the plan, before this landed.

## The overlays group was captioned "Category" (F3d — 2026-08-19)

Since the command bar it is captioned "Analysis" and the picker is in the bar;
the rest of this section is history.

`GROUP_LABELS` maps `overlays` to **"Category"**, not "affordance", because the
category `<select>` itself moved into that group through the
`options.extrasBefore` seam — so the control now sits directly under its own
heading, above the switches rather than below them.

`#show-below-label` is also an `overlays` extra — an `extrasAfter` one — and
`main.ts` **hides** it
while the `cells` layer is off (DEC-U9). That is a deliberate exception to this
module's `.layer-busy` rule, which is narrowed in `index.html` to say what it
governs: a control that is temporarily BUSY stays visible; one that is
INAPPLICABLE to the current mode is removed.

Two things that bit when it shipped, both worth knowing before touching it
again: the hiding has to be painted on FIRST LOAD as well as from the layers
subscriber (`subscribe` fires on change only, and `cells` is off by default —
so the one state DEC-U9 exists for was never painted), and `[hidden]` must be
given precedence over `header label { display: inline-flex }`, or the attribute
is set and nothing happens.

## `woods` joins `world` (objects M2a, 2026-11-08)

- Label "woods", beside "trees": invented trees in mapped woods, orchards and
  tree rows. The switch is the owner's on/off for them (default on).

## `furniture` joins `world` (objects M5, 2026-11-11)

- Label "furniture": mapped street lamps and bollards (benches and bins stay
  with "poi"). Default on. In the "City look" section, not `world`.

## Since S3 (colour schemes plan 2026-11-10-0841)

`groupOf` and `labelFor` read `Record<LayerKind, ...>` tables (exhaustive at
compile time) instead of switches, which the new `tint` layer took over the
complexity limit. `tint` is in the world group, labelled "land-use colours":
not "landuse" again, because the plates switch carries that word and e2e
locators match accessible names by substring.
