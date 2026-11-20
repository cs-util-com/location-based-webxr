# `travelling-box-check.ts` - the travelling box's check page

## Purpose

The code of `travelling-box-check.html` (`travelling-box-check.html.md`):
a narrated long text's reading sign in the reading stand's square
(`lectern-check.ts` `buildSquare`), its words painted on the plate under
the sign from the narration box's invisible ghost at the bottom of the
page. It exists so the build can be compared side by side with the
travelling box prototype
(`public/prototypes/sign-speaks-r6-2-travelling-box/`) and so the layout
e2e can pin where the plate hangs. Every part is the production one: the
sign (`reading-sign.ts`), the box in travel mode (`narration-box.ts`),
the painter (`narration-words-paint.ts`) and the plate's size and growth
(`travelling-box-rules.ts`). The voice is the long text check's
stand-in clock (`long-text-check.ts` `createCheckClock`), still until
moved.

## Public API

- `startTravellingBoxCheck(host)` - builds the renderer, the scene, the
  sign and the box, installs `window.__travellingBoxCheck` and draws
  every frame until `stop()`.
- `wordsPaintScale(devicePixelRatio)` - the texture's scale, 2.5 to 3
  device px a CSS px (2.5 for a ratio that is not a number).
- `TRAVELLING_BOX_CHECK_TEXT` - the prototype's weighing house text.
- The hook `window.__travellingBoxCheck`:
  - `standAt(distanceM, deg = 0)` - the eye 1.6 m up, `distanceM` from
    the sign, `deg` round from its front; throws on a distance that is
    not positive or an angle that is not finite.
  - `pitch(rad | null)`, `turn(rad)` - override the eye's pitch, turn it
    from facing the sign.
  - `at(ms)`, `play()`, `pause()` - the voice.
  - `state()` - the distance, the growth, the camera (position, yaw,
    pitch, field of view, view size), the sign's and the plate's corners
    on the page (projected from each mesh's own corners, TL, TR, BR, BL;
    null when not drawn), the plate's size in metres, the ghost box's
    rectangle and opacity, the texture (id, size, scale, paint count)
    and the voice (lit word, lines, rows, hint, total).
  - `wordsCanvas()` - the painted canvas, for a test to read its pixels.
  - `stop()`.

## Invariants & assumptions

- The eye is the prototype's: it faces the sign and looks at the middle
  between the sign and the words plate, both grown (`signGrowth`), with
  the pitch `atan2(lookH - 1.6, max(0.5, d))`. The field of view is
  `lecternCheckFovDeg`.
- The words are repainted only when `wordsPaintKey` or the layout
  changes; a new layout resizes the canvas (a new texture only when the
  size changes) and hangs the plate anew at `plateSizeM` of the box.
- The plate stays on the sign: the controller that moves the words
  between the sign and the screen comes in a later step.

## Tests

- `travelling-box-check.test.ts` - the paint scale.
- `playwright-tests/travelling-box-check.spec.js` - at three viewports,
  3 m away: the ghost's shape and opacity, the plate's size, its gap
  under the sign and its centre against values from the prototype's
  numbers, the width ratio; and the painted ink against the ghost's
  word rectangles.
