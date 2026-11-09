# The quiz world stage

One shared stage, so quiz variants differ only in the idea and are judged in
the same place. A variant writes a `kind.js`, a `sample.json` and a thin
`index.html`. The stage owns the scene, camera, renderer, frame loop, lights,
all input and the story card. `kind.js` and `sample.json` here are the sample:
copy them.

## Start

`quiz-world-<n>-<idea>/index.html`, this and nothing more:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover"
    />
    <meta name="robots" content="noindex" />
    <title>Two To Four Words</title>
    <script type="importmap">
      {
        "imports": {
          "three": "https://unpkg.com/three@0.185.1/build/three.module.js"
        }
      }
    </script>
  </head>
  <body>
    <script type="module">
      import { loadSamples, runStage } from "../quiz-world-stage/stage.js";
      import { kind } from "./kind.js";
      const samples = await loadSamples("./sample.json");
      if (samples) runStage({ kind, samples, title: "Two To Four Words" });
    </script>
  </body>
</html>
```

`runStage({ kind, samples | block, title, story?, at?, heading? })`:

- `samples`: `{ normal, longest, missing }`, raw records; the Cost panel switches them.
  `loadSamples(url)` fetches them, or says on the page why it could not and returns `null`.
- `story`: `{ speaker, station, before, after }`, the lines around the kind. Sensible defaults exist.
- `at: { x, z }`, `heading` (radians): where the stage puts the item. Default the middle of the square.

## The kind

```js
export const kind = {
  name: "my-kind", // the slot's data-kind, scope your CSS with it
  read(v, view, tools) {}, // optional: raw record to block, runs on every open
  fields: [/* FieldSpec */], // or fields(rawBlock) => [...]
  world(block, env) {
    return { object, update, tap, leave, back, dispose }; // only object is required
  },
  card(block, el, env) {
    // optional: DOM inside el only
    return { dispose() {} };
  },
  panel(rawBlock, el, env) {}, // optional: only when a FieldSpec cannot say it
};
```

- `read(v, view, tools)`: `view` mirrors the app's envelope view; this stage never sets it and
  always passes `null`, so a kind must work without it.
- `world` runs when the story reaches the kind, and in Edit. The object stays until Restart.
- `object`: metres, Y up, origin at the item's foot. Never set its own position or heading from
  outside knowledge: the stage hangs it from a holder.
- `update(frame)`: no allocation. `tap(hit)`, play only.
- `leave()` and `back()`: the visitor crossed the 12 m ring, play only. The stage folds the card
  on `leave` while the question is open and opens it again on `back`; a card the visitor
  folded by hand stays folded.
- `dispose()`: free every geometry, material and texture. Ten rounds will show what you missed.
  When `world()` throws, the stage frees what it painted with `paintText`; anything else it made
  is lost, so check the record in `read`, before building.

## `env`

- `env.mode`: `"play"` or `"edit"`, fixed for one open. A mode switch closes and reopens the world.
- `env.frame`: one object, also passed to `update`, never reallocated.
  - `time`: seconds since this open. **Stands at 0 in edit**, `dt` too. Drive all motion from it
    and edit is still by itself. `update` keeps running in edit, so a sign can face the creator.
  - `viewer`: the eye (Vector3), in the kind's own metres, y = 1.6. Local, so
    `Math.atan2(v.x - c.position.x, v.z - c.position.z)` faces a direct child at the viewer.
  - `viewerWorld`: the same in world metres, for `lookAt`.
  - `view`: where the visitor looks, a unit Vector3 in the kind's own metres; `viewWorld` in world
    metres.
  - `viewYaw`: `Math.atan2(view.x, view.z)` in radians, in the kind's own metres. It is the
    convention of `Math.atan2(dx, dz)` from the viewer to a point, so a point straight ahead has
    the same yaw.
  - `eye`: `{ position, quaternion, width, height, tanH, tanV }`, the eye as it draws this frame,
    for a kind that holds things to the screen. `position` (Vector3) is the camera itself, step
    bob included, and `quaternion` its orientation, looking along its own -z, both in the kind's
    own metres. `width` and `height` are the view in CSS pixels, `tanH` and `tanV` the tangents of
    half the field of view across and up. `update` runs after the stage moves the camera and
    before it draws, so it sees the frame that is drawn. Never touch the camera itself.
- `env.place`: `{ size: 40, edge: 20, ring: 12, anchors }`. `anchors` are Vector3s in the kind's
  own metres, aimed at the readable part: `fountain`, `statue`, `tree`, `bench`, `gate`, `hall`
  (its door) and `tower` (its clock, 25 m away, too far to walk to). In AR a creator would set
  these, so never assume where they are: read them. Do not mutate them.
- `env.paintText({ width, height, draw(g, w, h) })` returns a `CanvasTexture`. `width` and `height`
  are logical pixels, the canvas is those times the device pixel ratio capped at 2, the most is 2048. `512 x 256` is a good sign. `texture.repaint(draw?)` paints again. You dispose it. For light
  text on a transparent ground set `premultiplyAlpha` on the texture and `premultipliedAlpha` on
  the material, or paint an opaque plate: otherwise the edges fringe dark.
- `env.hitArea({ radius = 0.6, at?, name })` returns an invisible Mesh: add it to your object or to
  a child. It takes a tap inside `radius` metres of the ray, and within 26 CSS pixels of its centre
  however small or far. A hidden parent turns it off. Hit areas win over exact meshes, the closest
  to the tap first.
  To let the visitor tap a place: `object.add(env.hitArea({ at: env.place.anchors.tower, radius: 5, name: "tower" }))`.
- `tap(hit)`: `hit.name` is the first name walking up from what was hit, so name your parts.
  `hit.object`, `hit.point`, `hit.distance` are there too. A tap that hits nothing of the kind
  walks the visitor there. Taps only reach the kind's own object, never the place.
- `env.say(text, { mood: "calm" | "happy" | "doubt", ask, eyebrow })`: the guide's line in the
  card, the same slot for the question and the reaction. Call it from `card` or `world`.
- `env.done()`: the quiz is finished. The card's Skip becomes Continue, the next story line follows.
  Before that, Skip moves on. The stage does not read a result: points and whether to show them
  are yours.
- `env.sound(id).play()`: `tap`, `right`, `wrong`, `done`, synthesised, silent in edit.
- `env.loadAsset(id)`: rejects, this stage has no files.

## `FieldSpec`

Data, the same `{ name, label, prose }` the app's inspector reads, plus a `type`.
`name` is a dotted path into the raw block (`"answers.0.at"`).

- no type: one line; `prose: true`: text area; `max` caps it.
- `type: "number"` or `"range"`, with `min`, `max`, `step`.
- `type: "toggle"`.
- `type: "choice"`, with `options: ["a", "b"]` or `[["value", "Label"]]`.
- `type: "place"`: a value `{ x, z }` in the kind's metres. The stage draws a ring with the label on
  the ground in Edit, and a drag from that ring moves the field, inside the place's edge. This is
  how a kind declares a named placement. It rebuilds the world while dragging, so keep `world` quick.

Any field change closes and reopens the world with the new block. When `fields` is a function
and a change makes it answer another list, the panel and its place rings are drawn again, and the
focus stays in the field that had it.

## The story card

`el` is the slot under the guide's line, with `data-kind`. These classes carry the look that was
liked, use them instead of drawing your own:

- `.answers` (`.small`) holding `button.a`, states `.on`, `.right`, `.wrong`, `.was`, `.dim`.
- `.typed` holding `input.field` (`.right`, `.wrong`) and `button.check`.
- `.stamp`, `.echo`, `.plus` (`.none`), `.btn` (`.primary`), `.line`, `.speaker`.
- Tokens on `:root`: `--walk-accent`, `--walk-found`, `--walk-found-ink`, `--walk-ink`,
  `--walk-muted`, `--walk-surface`, `--walk-surface-2`, `--walk-line`, `--walk-danger`, `--gold`,
  `--tap`, `--font`.
- Your own CSS: a `<style>` inside `el`, every rule under `[data-kind="<name>"]`.

The card must leave the world visible. The phone's keyboard lifts it by itself.

## What the place gives you, and takes away

Walking: on a phone one thumb drags to look, the stick walks (up and down walks, sideways turns
and sidesteps, so one thumb can steer), or a tap on the ground walks there. On a desktop W A S D,
arrows, Shift to run, drag to look, click to walk. 1.4 m/s, eye at 1.6 m. Only the place's edge
stops the walker: objects are walked through, and the solid buildings stand outside the edge.

No shadows map, no post-processing, no sky, background or lights of your own. The Bright and Dark
buttons are there because in AR a camera image stands behind the kind: check both. Words in the
world are `paintText`, never HTML. The kind never touches scene, camera, renderer, DOM listeners
or `document` in `world`.

## Cost

The ms button opens the readout: frame ms, JavaScript ms, kind update ms, draw calls, triangles,
textures, geometries, and the stage alone for comparison. "Run ten rounds" closes and opens the kind
ten times within the same visit, so a finished quiz stays finished, then shows the same numbers. It says LEAK when memory grew or `dispose()` left anything
unfreed, including materials. First limits to compare with, one item: about 30 draw calls, 50 000
triangles, two 1024 px canvases, under 1 ms in `update`.

## Checking your variant

`window.__stage` has `state()` (position, mode, step, counts, cost, last ten rounds), `screenOf(x, y, z)`
(a world point on screen, to drive a tap) and `tenRounds()`. Serve by `index.html`, in Chromium headless
with `--use-angle=swiftshader`. Software GL runs at about 10 fps and the stage caps one step at
0.1 s, so wait on positions, not on the clock. A portrait phone sees only about 40 degrees across:
turn the view before you tap.

## Known limits

- The feel constants at the top of `stage.js` were checked by touch emulation, not on a phone, and
  frame times here are software GL. Only a real phone can judge them.
- The card keeps the app's `backdrop-filter` blur, which costs GPU over a moving canvas and is not in
  the readout.
- `update` is the only clock. A world part has no way to end the story early beyond `done`.
- The hit area radius ignores a scale on the parents.
