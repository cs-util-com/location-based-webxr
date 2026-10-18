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
          // The document and the shared pure modules (each other's peers).
          "^src/tour-document[^/]*\\.ts$",
          "^src/(object-edits|finish-rebuild|tour-content|authoring-draft|capture-bake)\\.ts$",
          // Read-only helpers, permanent: the visitor's photo spots
          // (`worldCaptureSpots`), the AR placement's world view
          // (`tourObjectsOf`).
          "^src/viewer-placement\\.ts$",
          "^src/creator-placement\\.ts$",
          // The draft's own modules, permanent: its storage (`withBaseKey`,
          // the draft's types) and the desktop's draft store (the offer
          // rules, and `hostedObjects` to tell what the opened file holds).
          "^src/draft-persistence\\.ts$",
          "^src/editor/editor-draft\\.ts$",
          // TEMPORARY - the desktop session's save: the rebuild's I/O
          // (`rebuildFinishedTour`, `captureSpotsForRebuild`), the saved
          // file's name (`finishedFileName`; the page reads it through the
          // session's `savedName`), the edit validators that shape a payload
          // (`pinTextEdit`, `moveObjectTo`), the written file's objects
          // (`hostedObjects`, for a deleted photo's picture) and the
          // `AuthoringObject` type - until the save moves into a
          // tour-document thunk (follow-up of D30).
          "^src/editor/editor-session\\.ts$",
          // TEMPORARY - the phone, until it adopts the tour document (the
          // phone adoption milestone of D30): its object list, draft,
          // settle and Finish still keep their own copy, and its station
          // guidance (M5c) reads the stations' content itself
          // (`applyObjectChanges` among it).
          "^src/(object-editing|creator-draft|creator-settle|creator-finish|creator-stations)\\.ts$",
        ],
      },
      to: {
        path: "^src/(object-edits|finish-rebuild|tour-content|authoring-draft)\\.ts$",
      },
    },
  ],
};
