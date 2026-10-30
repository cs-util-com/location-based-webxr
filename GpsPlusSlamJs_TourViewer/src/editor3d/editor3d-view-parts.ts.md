# editor3d-view-parts.ts

- Purpose: what the editor's two 3D views share - the OrbitControls view
  (`editor3d-scene.ts`) and the globe view (`editor3d-globe.ts`). Moved
  out of `editor3d-scene.ts` unchanged when the globe view arrived, so
  each lives once in the package.
- Public API:
  - `viewFailure(reason, message)` - an `Error` carrying `reason`
    (`ViewFailureReason`: `empty`, `webgl`, `chunk`, `context-lost`),
    which the view switch turns into its line.
  - `createViewRenderer(parameters?)` - a `THREE.WebGLRenderer`
    (`{ antialias: true }` by default), or a `webgl` failure when the
    constructor throws or the context is null (the renderer is then
    disposed).
  - `fillCredits(box, credits)` - the credits line: each short name as a
    link opening in a new tab, joined by " · ".
- Invariants & assumptions: no state; the DOM is the page's.
- Examples:
  ```ts
  const renderer = createViewRenderer();
  fillCredits(deps.credits, ground.credits);
  throw viewFailure("empty", "the tour has nothing with a position");
  ```
- Tests: through the views' e2e (`editor3d.spec.js`, `editor3d-globe.spec.js`:
  the credits line and a failed open's reason); `createViewRenderer`'s refusal
  needs a browser without WebGL and is not covered by a unit test.
