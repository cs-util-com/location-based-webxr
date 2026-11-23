# `anchors-check-main.ts`

## Purpose

Entry of `ar-anchors-check.html`. Builds the three.js scene (renderer with
WebXR on the `local` reference space, a white reticle ring, a green box for
the anchor, a larger red ring for the marker) and passes it, the clipboard,
`navigator.xr` and `XRRigidTransform` to the session and page modules.

## Invariants

- No behaviour of its own beyond rendering; every rule lives in the modules
  it wires, which carry the tests.
- The canvas is hidden outside a session.
- Not imported by the recorder (`anchors-check-isolation.test.ts`).

## Tests

None directly: it needs a real WebXR session. The modules it wires are
tested with fakes and the real markup.
