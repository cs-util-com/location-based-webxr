# `ar-entry-veil.ts`

## Purpose

The full-viewport layer between the camera feed and the city during the AR entry.
Fully opaque while the entry waits and falls, alpha 0 on landing — so the session
starts looking like the 3D view it came from and dissolves into the real world.

Added for the fifteenth field session (J1): _"eine Schicht … die zwischen dem
Kamerahintergrundbild und den 3D-OpenStreetMap-Szenendaten ist, die quasi den
kompletten Viewport ausfüllt … erst komplett sichtbar … und dann später …
herausgefadet wird"_.

## Why it exists — `renderer.setClearAlpha` is dead in AR

**This replaces DEC-Y3, which shipped and never worked on any device.** That
decision reasoned that `scene.background === null` makes the WebGL clear use the
renderer's own `clearColor`/`clearAlpha`, and that the framework's renderer is
built `alpha: true`. Both premises are true. The conclusion is still false,
because `WebGLBackground.render()` has a third branch that runs **after** ours:

```js
const environmentBlendMode = renderer.xr.getEnvironmentBlendMode();
if (environmentBlendMode === "additive")
  state.buffers.color.setClear(0, 0, 0, 1, premultipliedAlpha);
else if (environmentBlendMode === "alpha-blend")
  state.buffers.color.setClear(0, 0, 0, 0, premultipliedAlpha);
```

Every video-passthrough session reports `alpha-blend`, so the clear is forced
fully transparent and the camera is visible from frame one — which is exactly
what the field reported. On an optical see-through display the `additive` branch
forces opaque black, which on such a display _is_ transparent.

**No gate here could have caught it.** `getEnvironmentBlendMode()` returns
`'opaque'` outside an XR session, so the override never fires in vitest or in
headless Chromium, and the old unit assertion that `setClearAlpha` was called
passed against a call that provably did nothing. `ar-mode.test.ts` now asserts
`setClearAlpha` is **never** called, which is the guard that would have failed.

## Public API

- `ENTRY_VEIL_COLOUR = 0x11131a` — the 3D view's own background (DEC-J3).
  **Dark is a correctness constraint, not taste:** the AR city is drawn over this
  with `AdditiveBlending`, so the veil's colour is added to every building. A
  light veil would bleach the city for the whole entry.
- `ENTRY_VEIL_RADIUS_M = 50` — **a range, not a derived number.** Must clear the
  0.5 m near plane by a wide margin and stay inside the 1000 m far plane; roughly
  10–200 m satisfies both.
- `ENTRY_VEIL_FADE_S = 2` — how long the sphere takes to fade once the city has
  landed.
- `entryVeilAlpha(input: DescentInput): number` — `[0,1]`. **1 for the whole
  fly-in, then a smoothstepped fade over `ENTRY_VEIL_FADE_S` (DEC-M3).**
  - **It used to be `1 - cameraFadeAlpha`**, i.e. the exact inverse of how far
    the city had travelled, on the argument that the camera coming in and the
    veil going out are one visual event. The eighteenth field session's
    objection defeats that on its own terms: the event the camera should fade in
    FOR is the fly-in's **completion**, not its progress — at the half-way point
    the sphere was ~0.5 transparent with the city still 30 m overhead.
  - **One clock survives**, which is what mattered about the old rule: this is
    still a pure function of the descent's `elapsedS`.
  - **`startM ≤ 0` answers 0** — an explicit guard now, where it used to be
    inherited from `cameraFadeAlpha`. `ar-mode.ts` depends on it in two places.
- `createArEntryVeil(): ArEntryVeil` — `{ mesh, follow, setAlpha, dispose }`.

## Invariants & assumptions

- **The veil must not survive the entry.** An opaque surface left in an AR scene
  is a lid over the passthrough — worse than having no veil at all.
  - `entryVeilAlpha` returns **exactly** `0` at `hold + fall + ENTRY_VEIL_FADE_S`,
    not "close to" — and `ar-mode.ts` disposes the mesh when it reaches 0, so a
    curve that never quite got there would BE the lid.
  - ⚠️ **The disposal moved with the curve, and getting only half of that right
    is the trap.** The frame loop drives the sphere inside
    `if (descentStartS !== undefined)`, and the landing branch used to clear
    that in the same breath as disposing. Holding the alpha to landing while
    leaving the disposal there would drop an opaque veil; moving only the
    disposal would leave the sphere opaque for the rest of the session. The
    clock now survives the landing and is cleared where the mesh is disposed.
  - ⚠️ **A stalled frame loop now freezes the sphere at its most opaque.**
    `onXRFrame`'s early returns sit above the alpha writes, so a frame that
    skips rendering freezes the value — which used to mean "part-way faded" and
    now means "a full lid", over a window that grew from the 2 s hold to the
    whole entry. The session teardown's disposal is the backstop; a second clock
    to detect the stall would be a second thing that can disagree.
  - Every degenerate input (`startM` of 0, negative, `NaN`, either infinity; a
    `NaN` clock) resolves to **no veil**.
  - `setAlpha(NaN)` and `setAlpha(-1)` hide the mesh. Three renders a `NaN`
    opacity as fully opaque, so failing the other way would produce the lid.
    `+Infinity` is the one input clamped **up**, because unlike the others it is
    a real request for "as opaque as possible".
  - `ar-mode.ts` disposes it **twice over**: on landing, and again in
    `release()`. A session ended mid-descent never reaches the landing branch,
    and that is the common case when someone backs out because the entry looked
    wrong. `dispose` is therefore idempotent.
- **An inside-out sphere, not a camera-locked quad (DEC-J2).** A sphere centred
  on the camera covers every direction by construction — no field-of-view or
  stereo off-axis arithmetic, so it cannot leave a rim of live camera at the
  screen edge. That failure mode decided it: **no test here can catch it**,
  because headless Chromium never renders a stereo pair against a camera feed.
- **`side: BackSide`.** A front-sided sphere is invisible from within, which
  would look identical to the defect this module replaces.
- **`MeshBasicMaterial`, not `MeshStandardMaterial`.** A lit material would
  depend on the framework's lights; `ar-scene-environment.ts` records that a
  wrong AR lighting assumption makes every affected shader silently fail to
  compile, with the geometry vanishing and no error raised.
- **`fog: false`, `toneMapped: false`.** `ar-scene-environment.ts` installs a
  `THREE.Fog` over 0–1000 m and a renderer tone mapping; either would drift the
  veil off the colour it was asked for.
- **`depthTest: false`, `depthWrite: false`, `renderOrder = -1000`.**
  - The veil is `transparent`, so it is in three's **transparent** list and draws
    after the whole **opaque** list — `renderOrder` only sorts within a list.
    That is enough for what it must beat: the AR city is transparent-additive at
    the default order `0`, and `reversePainterSortStable` compares `renderOrder`
    before distance.
  - **It does NOT get under the opaque layers, and that is a stated
    consequence.** `setArShellMaterial` swaps only geometry carrying
    `aHeight01` — the buildings layer alone — so trees, POI plates and ribbons
    keep opaque depth-writing desktop materials. `depthTest: false` makes the
    veil immune to the depth they wrote, so it covers them: **those layers are
    hidden behind the veil for the whole entry and appear as it fades**, while
    the buildings are visible throughout. If a field session dislikes that, the
    fix is AR shell materials for those layers, not a change here.
  - An earlier draft of the plan claimed "the AR scene writes no depth at all"
    and "the veil is drawn before everything". Both were false; cold review
    caught them. The corrected argument is asserted rather than commented — the
    test compares `renderOrder` against `layer-order.ts`'s own values, so a new
    layer with a negative rung cannot silently sort underneath.
- **`frustumCulled = false` is insurance, not a requirement.** A 50 m sphere
  centred on the camera passes all six frustum planes anyway. Kept because
  culling a screen-filling veil is unrecoverable mid-entry; **not** asserted as
  a load-bearing choice.
- **The fade is `material.opacity` alone; `material.color` is never touched
  (DEC-J4).** `WebGLState.setBlending` is driven by `material.premultipliedAlpha`
  — which `Material` defaults to `false` — and **not** by the renderer's context
  attribute. The non-premultiplied `NormalBlending` branch is
  `(SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA)`, which already
  produces a premultiplied framebuffer for any destination. Scaling the colour
  as well would premultiply twice and fade the veil at roughly double speed. The
  test asserts both halves, including that `premultipliedAlpha` stays `false`.
- **The veil is positioned by `follow()` from the camera's world position, and
  nowhere else.** A non-finite component is **ignored**, keeping the last good
  centre: a `NaN` position removes the mesh from view, which mid-entry is
  indistinguishable from the defect this module fixes.

## Examples

```ts
const veil = createArEntryVeil();
scene.add(veil.mesh);
veil.setAlpha(1); // opaque while the entry gate waits
veil.follow(camera.getWorldPosition(scratch));
// …each frame…
veil.follow(camera.getWorldPosition(scratch));
veil.setAlpha(entryVeilAlpha({ elapsedS, startM: descentStartM }));
// …on landing OR on session end…
veil.dispose();
```

## Tests

- `ar-entry-veil.test.ts` — the curve (opaque through the hold, exactly zero on
  landing and after, monotonic, no veil for a zero/negative/non-finite descent)
  and the mesh (back-sided sphere of the right radius, render order below every
  layer, no depth test or write, unlit/unfogged/untonemapped, the colour-untouched
  fade invariant, `premultipliedAlpha === false`, hidden at zero, unusable alphas
  collapsing to invisible, `follow` ignoring broken input, dispose detaching _and_
  freeing, and dispose being idempotent).
- `ar-mode.test.ts` — the wiring: added when there is a descent and not when
  there is none, opaque for every frame the entry gate is closed, re-centred on
  the camera, disposed on landing and on a mid-descent `release()`, and
  `setClearAlpha` never called.

## Related

- [`ar-descent.ts`](./ar-descent.ts.md) — the clock and the curve both read from.
- [`ar-scene-environment.ts`](./ar-scene-environment.ts.md) — why AR materials are
  chosen conservatively, and the fog and tone mapping this opts out of.
- [`ar-building-material.ts`](./ar-building-material.ts.md) — the additive city
  drawn over this, and the reason the colour must stay dark.
- `GpsPlusSlamJs_Docs/docs/2026-08-22-0718-osm-demo-ar-entry-veil-and-header-blocks-plan.md`
  — DEC-J1…DEC-J4 and the cold-review verdicts.
