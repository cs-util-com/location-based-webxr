# `kinds/audio/narration-look.ts` - how a narration circle looks

## Purpose

The narration circle's look, the "plume" chosen from the narration prototype (`public/prototypes/audio-narration-spot-1/`, look `plume`), behind one function so that `spot.ts` does not change when the look does:

- a dashed rim on the ground at the radius, with a soft halo and a glow at the centre (about 1.5 m);
- a plume of motes rising from the centre, widening and turning as it climbs to 3.4 m, which marks "go there";
- a name plate above the plume (title and one line: what to do or what is happening), painted on a canvas;
- an invisible column a tap is cast against.

It shows the voice's state: the plume hurries while the voice plays (with a wave running out over the ground), slows when it is paused, and dims once heard. In the editor it stands still and its plate says what it is.

## Public API

- `narrationLook(radiusM, options)` -> `NarrationLook`:
  - `options.mode` - `"play"` or `"edit"` (still, plate "Narration, circle R m");
  - `options.title` - the plate's first line;
  - `options.plate` - `{ canvas, texture }`: the plate's canvas and its texture (the page's `canvasTexture`); none: no plate.
- `NarrationLook`:
  - `object` - the group to place; `tapTarget` - the unseen column;
  - `show(state, inside)` - the voice's `NarrationState` (`idle`, `playing`, `paused` by the visitor's tap, `away` while the visitor is out, `heard`) and whether the visitor is inside; repaints the plate only when its line changes; ignored in the editor;
  - `face(dx, dz)` - turns the plate about the vertical toward a viewer at `dx`, `dz` in the look's own frame;
  - `tick(seconds)` - one frame: writes the plume's clock and the ground's time uniforms, nothing else;
  - `dispose()` - frees every geometry, material and the plate's texture.
- `PLUME` - `{ count: 200, heightM: 3.4 }`, the plume's cost.

## Invariants & assumptions

- **Cost, fixed:** three draws at most (ground disc, one instanced plume of `PLUME.count` quads, the plate), whatever the radius. The motes move in the vertex shader; a frame writes two uniforms and never a buffer. The seeds are one array made at load and shared by every circle.
- **Frame cost:** still to be measured on a desktop and on a phone.
- The rise's clock never runs back and never steps more than 0.1 s of rise per frame (a tab left and come back to does not throw the motes ahead); its pace eases toward the state's rate (`RISE_RATE`).
- Colours are the sounds' warm palette (`warm-glow.ts`): the rim `rim`, the centre and motes `glow`, the motes' centres `spark`, the rim's dark edge `ink`. The prototype's orange is not used: the sounds keep the editor's warm glow.
- Ground at 1.4 cm, writes no depth; GLSL 3 (WebGL 2), `fwidth` for a rim one pixel sharp at any distance.
- A canvas without a 2D context paints nothing (the plate stays blank, nothing throws).

## Examples

```ts
const look = narrationLook(6, { mode: "play", title: "The old well", plate });
look.show("playing", true);
look.face(0, 8);
look.tick(1.5);
```

## Tests

`narration-look.test.ts`: the parts and their bounded count, the warm palette, a tick that writes uniforms only, the pace per state and still in the editor, a property that the rise never runs back or jumps, the states reaching both shaders, the plate's lines and repaint-on-change, facing, and disposal. `spot.test.ts` and `spot-card.test.ts` cover the circle around it. The look itself is checked side by side with the prototype on the check page.
