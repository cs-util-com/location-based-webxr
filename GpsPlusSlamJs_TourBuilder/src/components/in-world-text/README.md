# Component 2 — In-world text

A billboarded, **paginated** text panel rendered in 3D space — the building block
for the floating **story transcripts** that accompany a waypoint's audio in noisy
outdoor use. Like Component 1 it is a warm-up: framework-free, reusable in any
Three.js project, with **no tour, GPS, Redux, or zip**.

Its defining challenge (set by `TASK.md` §2.3.2) is rendering text that also works
**inside immersive WebXR**, where a DOM/CSS overlay is unreliable. So it renders
via two swappable backends behind one interface:

- **HTML-in-3D (primary)** — [`three-html-render`](https://repalash.com/three-html-render/)
  rasterizes an offscreen DOM subtree to a texture (XR-safe).
- **CanvasTexture (fallback)** — engaged automatically if the HTML backend throws
  or times out, at construction _or_ later (e.g. after entering XR).

Everything testable — wrapping, pagination, page state, hit-mapping, sizing — is
pure and backend-agnostic, so the fallback is transparent.

## Run it

```bash
pnpm dev   # then open http://localhost:8185/src/components/in-world-text/
```

Drag to orbit — labels stay upright and face you. Click a label's **Prev / Next**
to page; **Swap text** re-paginates and resets to page 1. The HUD shows each
label's active backend (`html` normally, `canvas` if it fell back) and page.
On an AR-capable Android phone, tap **START AR** and page with the controller
`select` ray (the same hit-mapping as the mouse).

## Layout

| Path         | What lives here                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `demo.ts`    | Standalone demo entry: scene, OrbitControls, Enter-AR, HUD, and the pointer/XR interaction wiring.      |
| `index.html` | The demo's page.                                                                                        |
| `core/`      | Pure, framework-free, unit-tested logic — wrapping, pagination, page state, hit-mapping, sizing, model. |
| `view/`      | Three.js view layer: the two `TextSurface` backends, the label factory (with fallback), and picking.    |

Shared upright-billboard math, `clamp01`, the UV `Rect`/`contains` primitive, and
the canvas draw helpers live in [`../shared/`](../shared/README.md) (reused with
Component 1).

## Data flow

```
pointer / XR select ─▶ label.hitTest(uv) ─▶ 'prev' | 'next' | null
                                              │
                              label.next()/prev() mutate the hosted
                              page state → re-render the current page
                              through the active TextSurface
```

Page state is **hosted inside each label** (per-label, ephemeral view state), not
a shared store — the pure `textPageReducer` is the source of truth; the view is a
projection of it.

## Tests

Pure `core/` logic is unit-tested (`*.test.ts`). The **fallback wiring** — the
reason the component has two backends — is unit-tested in
`view/in-world-text.test.ts` by injecting a surface factory that throws / stalls /
succeeds and asserting the resulting `activeBackend` (no GPU/DOM needed). The two
`TextSurface` backends' actual rendering is view-layer and verified via the demo
(desktop) and a manual `immersive-ar` session (phone) — Component 2 has no
movement dependency, so there is no replay e2e (same rationale as Component 1).
