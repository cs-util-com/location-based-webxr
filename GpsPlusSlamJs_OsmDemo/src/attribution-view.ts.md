# `attribution-view.ts`

## Purpose

The map's one footer line, at the bottom right:
**"© OpenStreetMap | Credits | Legal"**. The OSM credit is always visible and
linked; "Credits" opens the full list of every source; "Legal" is the site-wide
legal notice and privacy page.

## Public API

- `new AttributionView()` builds the element; it starts hidden and empty.
  - `.element: HTMLElement` is the control's root. It carries both
    `leaflet-control-attribution` and `map-attribution`.
  - `.setEntries(entries: readonly AttributionEntry[]): void` replaces the
    credited sources. Idempotent, order-preserving, and it **restores** the
    Credits view's open state rather than resetting it. A list equal by value
    to the last one touches nothing (`MapView` passes the same list on every
    terrain apply); a changed list that re-renders under focus moves focus to
    the same credit's new link, or to "Credits" when that credit is gone.
  - `.adoptLegalLink(link: HTMLAnchorElement): void` moves the page's own
    legal link to the end of the line, after a separator.
- `AttributionEntry` is `{ short, full, href?, pinned? }`.
  - `pinned: true` puts `short` in the resting line (as a link when `href` is
    set). Every entry, pinned or not, is a row of the Credits view showing
    `full`, linked when `href` is set.

No error modes: every input is a string and every path renders. A malformed
entry produces a visible oddity, never an exception, which is the right failure
for a control whose job is to keep a credit on screen.

## What each source requires, and why the line looks like this

Checked 2026-11-16 against the sources below. The demo uses three providers:
OpenStreetMap (raster tiles from `tile.openstreetmap.org` and Overpass data),
Mapterhorn elevation tiles, and the Mapzen/AWS Terrain Tiles as the fallback.
It does not use MapTiler (the name "Mapterhorn" is easy to misread as it).

- **OpenStreetMap, pinned.** The OSMF attribution guidelines
  (osmfoundation.org/wiki/Licence/Attribution_Guidelines, adopted 2021-06-25):
  "The attribution format should not require individuals to interact with the
  map or produced work to see the attribution", in a corner of an interactive
  map; the text must be to "OpenStreetMap", and making it a link to
  openstreetmap.org/copyright is how it also names the ODbL. "© OpenStreetMap"
  is one of the accepted forms.
- **Mapterhorn, in the Credits view, linked to mapterhorn.com/attribution/.**
  Mapterhorn compiles about 150 open sources; its attribution page lists each
  with its licence (`attribution.json`). Most are CC BY 4.0, Licence Ouverte
  2.0, Datenlizenz Deutschland Namensnennung 2.0, open government licences or
  public domain. CC BY 4.0 section 3(a) lets the credit be given "in any
  reasonable manner based on the medium", and says a URI or hyperlink to a
  resource carrying the required information may satisfy it. The text of
  Mapterhorn's attribution and data-access pages, as fetched, states no rule
  that its credit must be visible on the map.
- **Mapzen / AWS Terrain Tiles, in the Credits view, linked to the tilezen
  `joerd` attribution document.** That document lists the required source
  credits (USGS, Copernicus EU-DEM, Geoscience Australia and others) and says
  attribution must "appear in a place that is reasonable to the medium",
  pointing at the OSMF guidance as best practice. Following that best practice
  (the OSMF examples) would pin the elevation credit visible on the map; the
  requirement itself is only "reasonable to the medium", so keeping it one tap
  away is a choice, not something the document demands. The long list cannot
  fit in any map line, so it is linked from the Credits view.

**This reverses an earlier record.** Before this line, the elevation sources
kept a visible short name each, on the record that they were required "the
same as the OSM one". No provider text found states that; the licences above
accept a credit one tap away beside the map. If a provider's terms are later
found to require on-map visibility, set `pinned: true` on its entry in
`dem-provider.ts`; the line then shows it without any other change.

## Invariants & assumptions

- **The OSM credit is visible with no interaction**, as a link to its copyright
  page. This is the invariant with a licence behind it.
- **The demo owns this control; Leaflet's is switched off.**
  `Control.Attribution._update` ends by assigning `innerHTML` on its container
  and runs on every `addAttribution`/`removeAttribution`, which
  `MapView.setTerrainAttribution` calls on every terrain apply. A Credits view
  inside Leaflet's control would be destroyed mid-session at random.
- **The open state survives a re-render**, because that is the only reason
  owning the control pays for itself.
- **Focus never falls to `<body>`.** A re-render detaches the focused link,
  and Escape only reaches the control's handler from inside it, so an
  unchanged list skips the re-render and a changed one restores focus.
- **Keyboard:** "Credits" is a real `<button>` with `aria-expanded` and
  `aria-controls`. Escape anywhere inside the control closes an open view and
  returns focus to "Credits"; while closed, Escape is left to the page. It is a
  disclosure, not a modal: focus is not trapped, because the map stays usable.
- **The separators are `aria-hidden`.** Three links in a row read best with a
  pipe, but a screen reader announcing "vertical line" between them is noise.
- **The legal link is adopted, not created.** It stays in `index.html`, so the
  page offers it without this script (a fixed bottom-left fallback styles it
  while it is still a child of `<body>`), there is only one such link, and
  `tests/repo-config/legal-page.test.js` finds `href="/legal/"` in the HTML.
  Its visible text is "Legal"; its `aria-label` "Legal notice and privacy"
  starts with that word (WCAG 2.5.3).
- **Tap targets:** every link and the button are at least 24 x 24 px (WCAG 2.2
  SC 2.5.8), set in `index.html`; the line stays one line at 390 px.
- **Built with `textContent`, never a template string.** Credit strings are
  externally-authored text; avoiding the HTML sink beats escaping through one.
- **Hidden only when there is neither a credit nor a legal link.**
- **This file is DOM only.** The Leaflet wiring lives in `map-view.ts`; no unit
  test in this package instantiates a Leaflet map.

## Examples

```ts
const attribution = new AttributionView();
attribution.adoptLegalLink(document.getElementById("legal-link"));
attribution.setEntries([
  {
    short: "© OpenStreetMap",
    full: "© OpenStreetMap contributors",
    href: "https://www.openstreetmap.org/copyright",
    pinned: true,
  },
  ...DEM_ATTRIBUTION_ENTRIES,
]);
```

## Tests

- `attribution-view.test.ts` (jsdom): the resting line's exact text
  (separators included, read from the line itself rather than the whole
  control, whose `textContent` would also match the closed view); the pinned
  OSM link; unpinned credits only in the Credits view; `aria-hidden` pipes; the
  adopted legal link; open/close with `aria-expanded` and `aria-controls`;
  every credit with a page a link; Escape closing and returning focus, and
  leaving the key alone while closed; the open state across a re-render;
  focus kept on an unchanged list and restored on a changed one, with Escape
  still closing the view;
  removal of a source; the `textContent` rule; hiding when empty.
- `dem-provider.test.ts`: each elevation entry has an `https` link and is not
  pinned.
- e2e: `playwright-tests/boot-and-shell.spec.js` (the line's text, one line at
  390 px, 24 px targets, the Credits view, Escape and focus);
  `scene-3d.spec.js` (the terrain credit in the Credits view);
  `hud-layout.spec.js` (no overlap with the other floating controls).
