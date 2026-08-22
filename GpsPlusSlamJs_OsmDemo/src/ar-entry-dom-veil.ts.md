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
- `createArEntryDomVeil(container): ArEntryDomVeil` — inserts the element and
  returns an **idempotent** `remove()`.

## Invariants & assumptions

- **It goes up BEFORE `requestSession`, not after.** Anything that happens after
  `initAR` resolves is already too late by the whole duration of that call.
  `ar-mode.ts` reads `descentStartM` before the session for this reason —
  `cameraHeightM()` reads the DESKTOP camera, which starting a session does not
  touch, so the value is identical either way.
- **It comes down on the SECOND frame callback, not the first.** Both per-frame
  hooks run **before** `renderer.render(scene, camera)` in the same tick, so
  when the first callback fires nothing has been drawn. Removing there would
  uncover the passthrough for exactly the frame the mesh veil has not been
  rendered into — closing a sub-frame race with a trigger that fires one call
  too early.
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
covers entry only.

## Tests

- `ar-entry-dom-veil.test.ts` — colour agreement with the mesh veil, attachment,
  `aria-hidden`, idempotent removal, and that removing an earlier veil twice does
  not take a later one down with it.
- `ar-mode.test.ts` → "the DOM entry veil (DEC-K5)" — the ordering, which is the
  part that matters: present when `initAR` is called (asserted from inside the
  mock, the only vantage point that can tell before from after), surviving the
  first frame, gone on the second, never created without a descent, and removed
  on both a refused session and a normal end.
  - **Mutation-verified.** Removing on the first frame fails one test; creating
    the veil after `initAR` instead of before fails three.
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
