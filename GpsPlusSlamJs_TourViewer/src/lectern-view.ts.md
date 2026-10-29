# `lectern-view.ts` - the reading stand

## Purpose

Draws a long text in its `lectern` view (`tour.json` minor 3): a dark
board on two legs and feet at the block's pose, its page a canvas texture
with the paragraph header, the title, a rule, nine lines of the current
paragraph with the current sentence highlighted (what came before
dimmer, what follows lighter) and a footer saying how to turn it; a tap on
the page turns it. Built as the narrated-text prototype builds its
lectern (`public/prototypes/station-blocks-1-narrated-text/`), without
its voice: the page follows a narration only once a long text carries
one, which the format does not have yet.

## Public API

- `LECTERN_STAND` - the stand in metres: a 1.2 x 0.9 m page leaning back
  16 degrees, its centre 1.32 m up, legs 0.42 m off centre, colour
  `#2b2d31`.
- `drawLecternPage(g, { title, text, sentence })` - draws the page onto a
  `LECTERN_PAGE` sized 2D context; the sentence is clamped to the text's
  range; an empty text draws only the frame; a long title is cut with an
  ellipsis to the line's width.
- `buildLecternStand(pageMap | null)` -> `{ root, page, dispose }` - the
  geometry, its root on the ground; the page plane is named
  `lectern-page`; a null map draws a blank page.
- `mountLectern({ id, title, body })` -> `LecternHandle` - builds a stand
  with a canvas page for a block (`body` is Markdown, shown as its plain
  text, `plainTextOf`), registers it and sets `userData.objectId`. Throws
  when the page has no 2D canvas. The handle has `blockId`, `object` (the
  stand, placed by the caller), `page` (what a tap is cast against),
  `sentence()`, `turn()` and `dispose()` (idempotent; removes it from the
  scene and the registry).
- `mountedLecterns()` - the mounted stands not yet disposed, oldest
  first.
- `turnLecternUnderTap(handles, pick, tap)` - turns the stand whose page
  `pick` (the page's `pickObjectInView`) finds under the tap; true when
  one turned. With no stands `pick` is not asked.

## Invariants & assumptions

- The stand keeps its pose (it does not turn to the visitor) and faces
  its local +z, the photo planes' rule, so a creator's "face me" rotation
  turns the page toward them. Up is local +y.
- The page is redrawn only on a turn; the texture is sRGB and the page
  material is unlit and not tone-mapped, so the page reads the same in
  any light, as in the prototype.
- `main.ts` routes a tap here after the character and the model card
  (`visitor-stations.ts` `routeVisitorTap`), among the stands shown
  (`model-visitor.ts` `shownIn`).

## Not built (needs a narration in the format)

The page following the voice, the spoken-word mark, the footer's progress
fill and the voice's credit. The footer's track is drawn empty.

## Examples

```ts
const stand = mountLectern({ id: "b1", title: "The hall", body: "One. Two." });
stand.object.position.set(0, 0, -3);
scene.add(stand.object);
stand.turn();
stand.dispose();
```

## Tests

`lectern-view.test.ts` (the page's text, colours, highlight and footer
with a recording context; the stand's geometry; the tap routing);
`content-placement.test.ts` (placed at its local pose through the
builder); `playwright-tests/lectern-check.spec.js` (where the drawn page
lands at three viewports, and the tap turning it).
