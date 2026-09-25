/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  options: {
    doNotFollow: { path: "node_modules" },
    // `three` itself is included (but never followed, see doNotFollow) so the
    // ar-scene runtime boundary rule below has an edge to match on — with a
    // src/components/store-only graph, external imports simply vanish and the rule
    // could never fire. gps-plus-slam-osm and h3-js are included the same way,
    // for the desktop-preview-only boundary rule below.
    includeOnly: [
      "^src/components",
      "^src/store",
      "^src/app",
      "node_modules/three/",
      "node_modules/gps-plus-slam-osm/",
      "node_modules/h3-js/",
    ],
    reporterOptions: { dot: { collapsePattern: "node_modules/[^/]*" } },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
  forbidden: [
    // One-way boundary: feature components may import the shared store contract,
    // but the store must never depend on a component.
    {
      name: "store-not-to-components",
      comment:
        "src/store/ is the shared contract (Component 3). It must not import from feature components — dependencies flow components → store only.",
      severity: "error",
      from: { path: "^src/store/" },
      to: { path: "^src/components/" },
    },

    // Goal-2 composition boundary: src/app/ composes components/store, never
    // the other way around — a component or the store reaching UP into the
    // composition layer would break "components first, composition last"
    // and the individual-demo-ability every component is built to keep.
    {
      name: "components-and-store-not-to-app",
      comment:
        "src/components/ and src/store/ must not import from src/app/ — dependencies flow app → components/store only (mirrors store-not-to-components).",
      severity: "error",
      from: { path: "^src/(components|store)/" },
      to: { path: "^src/app/" },
    },

    // Component 8's three-layer split (plan A20): `runtime/` orchestrates the
    // scene but must stay renderable-agnostic, talking only to the SceneAdapter
    // port. A runtime import of `three` would defeat the whole reason the port
    // exists — the replay e2e drives `runtime/` in Node with no WebGL. Type-only
    // imports are allowed (they carry no runtime dependency; component 4's pure
    // core does the same for `Vector3`).
    {
      name: "ar-scene-runtime-not-to-three",
      comment:
        "src/components/ar-scene/runtime must not depend on three at runtime — render through the SceneAdapter port instead (plan A20).",
      severity: "error",
      from: {
        path: "^src/components/ar-scene/runtime/",
        // Tests and the fake adapter STAND IN for the view layer, so they are
        // allowed to build real THREE objects (positions, matrices).
        pathNot: "\\.test\\.ts$|fake-scene-adapter\\.ts$",
      },
      to: { path: "node_modules/three", dependencyTypesNot: ["type-only"] },
    },

    // Desktop-preview-only dependency (plan
    // 2026-08-27-desktop-preview-osm-buildings-plan.md): gps-plus-slam-osm and
    // h3-js pull in a live Overpass client and are online-only. The real
    // AR/phone viewing path must keep working with no network beyond the
    // packaged tour, so neither may reach it — even transitively through
    // src/app/viewing, which composes the live session.
    {
      name: "osm-desktop-preview-only",
      comment:
        "gps-plus-slam-osm/h3-js are for components/desktop-preview only — the real AR/phone path (ar-scene, app/viewing) must not depend on them.",
      severity: "error",
      from: { path: "^src/components/ar-scene/|^src/app/viewing/" },
      to: { path: "node_modules/(gps-plus-slam-osm|h3-js)/" },
    },

    // Catch typos in import paths (unresolvable specifiers)
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },

    // No circular dependencies (component dependency loops)
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
};
