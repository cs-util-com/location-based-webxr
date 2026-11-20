# `travelling-box-check.ts` - the travelling box's check page

## Purpose

The code of `travelling-box-check.html` (`travelling-box-check.html.md`):
a narrated long text's reading sign in the reading stand's square
(`lectern-check.ts` `buildSquare`), its words painted on the plate under
the sign from the narration box's invisible ghost at the bottom of the
page, and moved between the sign and the dock by the travelling box's
controller. It exists so the build can be compared side by side with the
travelling box prototype
(`public/prototypes/sign-speaks-r6-2-travelling-box/`) and so the layout
e2e can pin where the plate hangs. Every part is the production one: the
sign (`reading-sign.ts`), the box in travel mode (`narration-box.ts`),
the words as a surface (`travelling-box-sign.ts`), the controller
(`travelling-box.ts`) and its registry (`travel-registry.ts`), with the
default knobs (`travelling-box-rules.ts`). The voice is the long text check's
stand-in clock (`long-text-check.ts` `createCheckClock`), still until
moved.

## Public API

- `startTravellingBoxCheck(host)` - builds the renderer, the scene, the
  sign and the box, installs `window.__travellingBoxCheck` and draws
  every frame until `stop()`.
- `TRAVELLING_BOX_CHECK_TEXT` - the prototype's weighing house text.
- The hook `window.__travellingBoxCheck`:
  - `standAt(distanceM, deg = 0)` - the eye 1.6 m up, `distanceM` from
    the sign, `deg` round from its front; throws on a distance that is
    not positive or an angle that is not finite.
  - `pitch(rad | null)`, `turn(rad)` - override the eye's pitch, turn it
    from facing the sign.
  - `at(ms)`, `play()`, `pause()` - the voice.
  - `state()` - runs and renders a frame, then reports the distance, the growth, the camera (position, yaw,
    pitch, field of view, view size), the sign's and the plate's corners
    on the page (projected from each mesh's own corners, TL, TR, BR, BL;
    null when not drawn), the plate's size in metres, the ghost box's
    rectangle and opacity, the texture (id, size, scale, paint count)
    and the voice (lit word, lines, rows, hint, total, the line as a
    float, playing); plus the controller's `travel` state (place, why,
    u, presence, the plate's and the drawn quad's corners relative to
    the view, the dock, the metrics, which mesh shows, both texture ids,
    the surface id), whether the ghost takes pointers, the view rect and
    the settled place events so far, and the words plate's own material
    map id.
  - `hold(s | null)` - both holds set to `s` seconds (null: the
    defaults), with a fresh controller.
  - `openSheet()`, `closeSheet()` - the reading sheet's hide reason.
  - `cost()` - the controller's cost counters.
  - `wordsCanvas()` - the painted canvas, for a test to read its pixels.
  - `stop()`.

## Invariants & assumptions

- The eye is the prototype's: it faces the sign and looks at the middle
  between the sign and the words plate, both grown (`signGrowth`), with
  the pitch `atan2(lookH - 1.6, max(0.5, d))`. The field of view is
  `lecternCheckFovDeg`.
- One frame: the box follows the voice, the sign chip follows the
  clock (Speaking while it runs, Heard to the end at the end, Paused
  after a start, Has a voice before; `setVoiceState` repaints only on a
  change), the eye is placed, the sign is
  updated (its growth from the `grow` knob, `signWordsGrowth`), then the
  registry runs the controller, then the render. A `pointerdown` on the
  canvas goes to the registry, which forwards a finger on the plate or
  the flying quad to the ghost.
- The view rect is the host's, read on resize; the controller is
  handed the page's one canvas (`wordsCanvas()`) and uploads with
  `renderer.initTexture`.

## Tests

- `playwright-tests/travelling-box-check.spec.js` - at three viewports,
  3 m away: the ghost's shape and opacity, the plate's size, its gap
  under the sign and its centre against values from the prototype's
  numbers, the width ratio against each edge's depth along the pitched
  view (within 0.2 %); and the painted ink against the ghost's
  word rectangles.
