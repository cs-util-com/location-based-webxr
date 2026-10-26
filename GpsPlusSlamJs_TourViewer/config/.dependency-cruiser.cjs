/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  options: {
    doNotFollow: { path: "node_modules" },
    includeOnly: "src",
    reporterOptions: { dot: { collapsePattern: "node_modules/[^/]*" } },
  },
  forbidden: [
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

    // The desktop editor (`src/editor/`, its own page) imports Leaflet
    // statically; the visitor page must never reach it, or every visitor
    // downloads the map library. `summary-map-lazy.test.ts` scans only the
    // top level of `src/`, so this rule closes the gap (M6 E1 plan review
    // #5).
    {
      name: "viewer-not-to-editor",
      severity: "error",
      from: { path: "^src/[^/]+\\.ts$", pathNot: "\\.test\\.ts$" },
      to: { path: "^src/editor/" },
    },

    // The 3D editor (`src/editor3d/`) brings the globe and the 3D tiles
    // renderer: like the desktop editor, the visitor's and the phone's
    // pages must never reach it. That no module outside the editors
    // imports those PACKAGES is held by `src/editor-only-packages.test.ts`
    // (this config reads only `src/`, so a package import is invisible
    // here).
    {
      name: "viewer-not-to-editor3d",
      severity: "error",
      from: { path: "^src/[^/]+\\.ts$", pathNot: "\\.test\\.ts$" },
      to: { path: "^src/editor3d/" },
    },

    // The creator's landing (`src/landing/`) is the start page's first
    // screen: its parts load on every creator's first visit, so they must
    // never reach either editor (Leaflet, the globe, the 3D tiles). The two
    // rules above read only the top level of `src/`, which leaves this
    // folder out.
    {
      name: "landing-not-to-editor",
      severity: "error",
      from: { path: "^src/landing/", pathNot: "\\.test\\.ts$" },
      to: { path: "^src/(editor|editor3d)/" },
    },

    // The walk's camera captures are debug data, shown only in the desktop
    // editor's debug layer (`src/editor/debug-capture-layer.ts`, M1 of the
    // debug-captures plan): no phone or visitor module places them, so
    // none reaches the join that does - neither its entry
    // (`debug-captures.ts`) nor the join underneath it
    // (`capture-geo-join.ts`), which only that entry imports (a phone
    // module importing the join directly passed the rule before it named
    // both).
    {
      name: "debug-captures-editor-only",
      severity: "error",
      from: {
        path: "^src/[^/]+\\.ts$",
        pathNot: ["\\.test\\.ts$", "^src/debug-captures\\.ts$"],
      },
      to: { path: "^src/(debug-captures|capture-geo-join)\\.ts$" },
    },

    // The tour a creator edits has ONE copy: the tour document
    // (`tour-document.ts`, D29-D31). Its rules - the object edits, the
    // Finish's manifest, the stations' content, the objects a written file
    // holds and how a change applies to them (`authoring-draft.ts`'s
    // `hostedObjects`, `applyObjectChanges`; the r875 milestone review #6:
    // a rule is per module, so the draft's other rules are protected with
    // them and the draft's own modules are named) - are applied by its
    // reducers, so a page that imported them directly could keep a second
    // copy that means something else (the split that earned the root rule
    // "App state lives in the Redux store"). Only the document, the shared
    // pure modules themselves and tests may import them; every other
    // importer is named below with its reason.
    {
      name: "document-rules-through-tour-document",
      severity: "error",
      from: {
        path: "^src/",
        pathNot: [
          "\\.test\\.ts$",
          "^src/test-support/",
          // The document and the shared pure modules (each other's peers),
          // named one by one: a new `tour-document-*` module is not exempt
          // until it is listed here. `tour-document-draft.ts` is the draft's
          // follower; `tour-document-save.ts` is the document's save - I/O,
          // the rebuild - whose snapshot and landing read the rules.
          "^src/tour-document\\.ts$",
          "^src/tour-document-draft\\.ts$",
          "^src/tour-document-save\\.ts$",
          "^src/(object-edits|finish-rebuild|tour-content|authoring-draft)\\.ts$",
          // Read-only helper, permanent: the AR placement's world view
          // (`tourObjectsOf`).
          "^src/creator-placement\\.ts$",
          // The draft's own modules, permanent: its storage (`withBaseKey`,
          // the draft's types) and the desktop's draft store (the offer
          // rules, and `hostedObjects` to tell what the opened file holds).
          "^src/draft-persistence\\.ts$",
          "^src/editor/editor-draft\\.ts$",
          // ...and the phone's draft store, its peer (the offer rules,
          // `hostedObjects`); it reads the tour only through the document.
          "^src/creator-draft\\.ts$",
          // TEMPORARY - the phone's Finish: its rebuild I/O
          // (`rebuildFinishedTour`, `finishedFileName`) - until it saves through the document's
          // save (`tour-document-save.ts`, the desktop editor's already;
          // follow-up of D30). The phone's tour itself is the document
          // since its adoption (`creator-document.ts`).
          "^src/creator-finish\\.ts$",
        ],
      },
      to: {
        // `code-book.ts` since the codes moved into the store (debug-captures
        // plan M3a): the document's codes reducers apply its rules, and the
        // creator's codes module is a facade over them.
        path: "^src/(object-edits|finish-rebuild|tour-content|authoring-draft|code-book)\\.ts$",
      },
    },
  ],
};
