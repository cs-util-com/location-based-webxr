# `ar-entry-dom-veil.ts`

## Purpose

An opaque DOM layer over `#ar-root`, covering the one window in AR entry that a
**scene mesh cannot reach**: from `navigator.xr.requestSession` resolving to the
first `renderer.render`.

## The window, and why the obvious diagnosis is wrong

The sixteenth field session reported: black with "Finding your position…", then
**a flash of the camera**, then black again, then the correct fade. The reporter
diagnosed it as the entry sphere being built too late — _"er baut zu spät diese
Geometrie, diese Kugel"_.

**That diagnosis is wrong, and the code says so.** Between `initAR` resolving
and `scene.add(entryVeil.mesh)` there is **no `await`**, so three never renders a
frame without the mesh veil in the scene.

The real window is earlier:

1. `requestSession` resolves — **immersive compositing has begun and the
   passthrough camera is on screen**.
2. `await renderer.xr.setSession(...)` awaits three async XR calls
   (`makeXRCompatible`, `updateRenderState`, `requestReferenceSpace`), during
   which the XR layer is either not created or never drawn.
3. In an `alpha-blend` session, **an undrawn framebuffer IS the camera image**.
4. The first `renderer.render` finally paints the mesh veil.

No mesh helps between 1 and 4, because there is no rendered scene yet.

**The DOM can, because `#ar-root` is the session's `domOverlay` root** and the
browser composites that subtree over the camera and the WebGL layer whether or
not WebGL drew anything. That is also why `.ar-entry-wait` — which has no
background of its own — appears as text over live camera on any frame that
skipped `renderer.render`; the frame loop has two early returns that do exactly
that.

## Public API

- `ENTRY_DOM_VEIL_CLASS` — the class the stylesheet paints, exported so the e2e
  can query it without a duplicated string.
- `entryDomVeilColour(): string` — `ENTRY_VEIL_COLOUR` as CSS. **Derived, never
  written twice**: the whole effect depends on the handover between the two
  veils being invisible, and two hex literals that must agree is a shape this
  repo has been bitten by.
- `ENTRY_DOM_VEIL_FADE_S = 3` — how long the fade-out runs once it starts.
- `domVeilAlpha(elapsedS): number` — the fade curve, `1` at and before 0,
  smoothstepped to exactly `0` at `ENTRY_DOM_VEIL_FADE_S`. **Every non-finite
  reading collapses to `0`, never to `1`** — see the lid rule below.
- `createArEntryDomVeil(container): ArEntryDomVeil` — inserts the element and
  returns `setAlpha()` plus an **idempotent** `remove()`.

## The fade, and why it is not a CSS animation (DEC-L1, DEC-L1b)

The veil used to be removed in one step on the second frame callback. The
**seventeenth** field session still saw a flash of camera at exactly that
instant. Three causes are possible and **no gate in this repo can separate
them**: a later frame that skipped `renderer.render`, a one-frame seam between
the DOM-overlay compositor layer and the WebGL layer, or a two-frame margin too
thin for the device. A fade covers all three, which is a better reason to take
it than a diagnosis nobody can confirm.

- **The fade STARTS where the removal used to happen**, so the fully-black
  period is never shorter than the one it replaces — the property that makes
  this incapable of regressing the old behaviour. Starting it at insertion (the
  literal reading of the request) was rejected: insertion is before
  `requestSession`, so a slow permission grant would finish the fade while the
  consent dialog is still up.
- **Driven from the XR frame loop, not by CSS — on TESTABILITY.** jsdom runs no
  animations, so a CSS fade could be asserted as "a class was added" and nothing
  more; a pure `domVeilAlpha` is testable including its degenerate inputs, which
  is where a lid would come from.
  - ⚠️ **NOT because "the frame clock is guaranteed to run".** It is not:
    `onXRFrame`'s two early returns sit above the callback registry, so on
    exactly the frames where passthrough shows through, the fade is not
    recomputed and **freezes at its current opacity**. That is benign, and
    arguably right — a frame showing raw camera is a frame that wants cover —
    but it is a real behaviour and is recorded here rather than discovered.
  - A CSS animation would not have produced a black lid either; a missed
    `animationend` leaks an _invisible_ element. The honest asymmetry is
    testability alone.
- ⚠️ **Unmeasured cost:** one full-viewport `style.opacity` write per frame for
  3 s, in the DOM-overlay layer, which re-rasterises on the browser's schedule.
  If AR entry gets slower on a device, suspect this first.

## Invariants & assumptions

- **It goes up BEFORE `requestSession`, not after.** Anything that happens after
  `initAR` resolves is already too late by the whole duration of that call.
  `ar-mode.ts` reads `descentStartM` before the session for this reason —
  `cameraHeightM()` reads the DESKTOP camera, which starting a session does not
  touch, so the value is identical either way.
  - ⚠️ **The desktop therefore goes black while the consent prompt is up, and
    that is the accepted price.** `#ar-root` is hidden only while `:empty`, so
    inserting the veil covers the page immediately and the browser's AR
    permission dialog sits over a black rectangle. Waiting for the grant is not
    available — `initAR` wraps `requestSession`, and the window this veil exists
    for opens the moment that call resolves. Every exit path removes it, so a
    refusal returns to the desktop view. Raised by the PR #342 review.
- **It starts FADING on the SECOND frame callback, not the first, and is
  removed when the curve reaches 0.** Both per-frame hooks run **before**
  `renderer.render(scene, camera)` in the same tick, so when the first callback
  fires nothing has been drawn. Fading there would start uncovering the
  passthrough on exactly the frame the mesh veil has not been rendered into —
  closing a sub-frame race with a trigger that fires one call too early.
  - **Removal is driven by the alpha, not by a second timer**, so the element
    and its opacity cannot disagree about whether the entry is over.
- **It is gated on `descentStartM > 0`, the same condition as the mesh veil.**
  A ground-level entry builds no mesh veil and fades nothing, so a DOM veil
  there would be an opaque lid with nothing to lift it. Sharing the condition is
  what stops the two disagreeing about whether an entry is being veiled.
- **`remove()` is idempotent because the success path calls it twice** — once
  from the frame hook and once from `release()`. A second call that threw would
  surface as a failed AR entry.
- ⚠️ **Every exit path must remove it, and `endARSession()` does NOT.** The
  framework's teardown removes its own canvas and no other child. `#ar-root` is
  `position: fixed; inset: 0` and hidden only while `:empty`, so a leaked opaque
  child is a full-viewport black rectangle over the desktop app. Three paths
  need it: `release()`, the `initAR` rejection (the user dismissing the AR
  prompt), and the null-scene guard.
- **`pointer-events: none`** — it spans the viewport and the AR exit affordance
  is underneath.
- **`aria-hidden`** — it carries no information; `.ar-entry-wait` is the
  accessible status with `role="status"`, and a second node would be announced
  for a layer that says nothing.

## What this does NOT fix

**Frames that skip `renderer.render` after the veil is gone.** The frame loop's
two early returns still show raw passthrough if they fire mid-session. This veil
covers entry only — the 3 s fade extends "entry" by three seconds, which is one
of the three candidate causes it was lengthened for, but a skipped frame at
t = 10 s is still uncovered and always will be.

## Tests

- `ar-entry-dom-veil.test.ts` — colour agreement with the mesh veil, attachment,
  `aria-hidden`, idempotent removal, that removing an earlier veil twice does
  not take a later one down with it, and the fade: opaque at 0, exactly 0 at
  `ENTRY_DOM_VEIL_FADE_S`, monotone in between (property-based), every
  non-finite reading collapsing to transparent, and `setAlpha` clamping — an
  out-of-range CSS `opacity` is dropped by the browser, which restores the
  element to fully opaque.
- `ar-mode.test.ts` → "the DOM entry veil (DEC-K5)" — the ordering, which is the
  part that matters: present when `initAR` is called (asserted from inside the
  mock, the only vantage point that can tell before from after), surviving the
  first frame, **still attached and at opacity 1 on the second**, part-way faded
  half-way through, gone at the end of the fade, never created without a
  descent, and removed on a refused session, a normal end, **and a session that
  ends mid-fade** — the ~3 s window the fade creates that the hard cut did not.
  - **Mutation-verified, re-run for the fade.** Fading from the first frame
    fails one test; a degenerate clock reading resolving to opaque instead of
    transparent fails one test; creating the veil after `initAR` instead of
    before fails three.
- `boot-and-shell.spec.js` — asserts `#ar-root` is empty after a refused entry.
  ⚠️ **This does NOT guard this veil, and the sidecar says so deliberately.**
  The veil is created only when `descentStartM > 0`, and that fixture's desktop
  camera gives 0 — verified by mutation: deleting the removal from the refusal
  path leaves the e2e green. It guards the framework's own canvas, which is
  what it guarded before. Recording it as this veil's e2e would have been an
  assertion that looks like a guard and is not.

⚠️ **No gate here can prove the flash is gone on a phone.** That is the same
honest limit the mesh veil shipped with, and the reason this module exists at all
is a field report rather than a failing test.

## Related

- [`ar-entry-veil.ts`](./ar-entry-veil.ts.md) — the mesh veil this hands over to.
- [`ar-mode.ts`](./ar-mode.ts.md) — the entry sequence and the three exit paths.
