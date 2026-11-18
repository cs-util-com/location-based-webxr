# editor3d-view-parts.ts

- Purpose: the 3D view's parts kept apart from the globe view
  (`editor3d-globe.ts`): small, and testable without it. They were shared
  with an older 3D view, since removed.
- Public API:
  - `viewFailure(reason, message)` - an `Error` carrying `reason`
    (`ViewFailureReason`: `empty`, `webgl`, `chunk`, `context-lost`),
    which the view switch turns into its line.
  - `createViewRenderer(parameters?)` - a `THREE.WebGLRenderer`
    (`{ antialias: true }` by default), or a `webgl` failure when the
    constructor throws or the context is null (the renderer is then
    disposed).
  - `drawnCounts(renderer)` - `{ drawCalls, triangles }` of the last
    frame (`renderer.info.render`): the one accessor both views' readouts
    use, so a change to how they count lands in both.
- Invariants & assumptions: no state; the DOM is the page's.
- Examples:
  ```ts
  const renderer = createViewRenderer();
  throw viewFailure("empty", "the tour has nothing with a position");
  ```
- Tests: `editor3d-view-parts.test.ts` (`drawnCounts`); through the views' e2e (`editor3d.spec.js`, `editor3d-globe.spec.js`:
  a failed open's reason); `createViewRenderer`'s refusal
  needs a browser without WebGL and is not covered by a unit test.
