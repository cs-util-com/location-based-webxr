# `quest-marker.ts`

## Purpose

Builds the gold exclamation-mark SVG that marks a chosen geo-event, and states
its box size.

## Public API

- `QUEST_MARKER_PX: 22` — the icon box in CSS pixels. `map-view.ts` uses it for
  both `iconSize` and the centred `iconAnchor`.
- `questMarkerSvg(): string` — the marker's SVG, for `L.divIcon`'s `html`.

No inputs, so no error modes. The only substitution is `GEO_WINNER_COLOUR`,
imported from `surface-colours.ts`.

## Invariants & assumptions

- **A glyph, not a coloured circle (DEC-G6).** The winner and the nine
  candidates it beat used to be the same shape at different sizes, so the answer
  carried the same visual weight as the draws it was chosen from. Shape is what
  survives being one of eleven markers at zoom 18.
- **`L.marker` + `divIcon`, not `circleMarker`, and that is forced.** A
  `circleMarker` is an SVG `<path>`; CSS can recolour a path but cannot turn it
  into a character.
- **The glyph is geometry, never a `<text>` node.** `<text>` renders in whatever
  font the device has and centres differently on each, so the marker would be
  subtly wrong on exactly the phones this demo is tested on.
- **It carries a dark rim.** The basemap is dark, which makes a bare gold disc
  readable — until the winner lands on a yellow-end Viridis cell, which is where
  it most often lands, because the climb walks towards high heat.
- **The colour comes from the constant, never a literal.** The reported defect
  was a four-way collision that survived because the colours lived in CSS and in
  two TS literals with nothing able to compare them.
- **No caller data reaches the markup**, so no escaping is needed here. Tooltips
  do carry rule-sheet strings and go through the framework’s `escape-html.ts`.

## Examples

```ts
L.marker([pick.position.lat, pick.position.lng], {
  icon: L.divIcon({
    className: "geo-winner",
    html: questMarkerSvg(),
    iconSize: [QUEST_MARKER_PX, QUEST_MARKER_PX],
    iconAnchor: [QUEST_MARKER_PX / 2, QUEST_MARKER_PX / 2],
  }),
});
```

## Tests

`quest-marker.test.ts` — the colour comes from the shared constant, the glyph is
a rect and a circle rather than text, the `viewBox` agrees with the icon box, the
rim is present, and the SVG is `aria-hidden`.

`marker-palette.test.ts` owns the palette itself: that the four map markers
differ, that the candidates stay in the winner's hue family, and that nothing
else does. `map-and-cells.spec.js` asserts the marker reaches the map.
