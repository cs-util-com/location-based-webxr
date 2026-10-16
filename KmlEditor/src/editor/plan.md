# Non-AR Preview / Editor — Implementation Plan

## Overview

`src/editor` is the phone-free composition surface for Goal 2. It turns the already implemented KML/KMZ engine, coordinate bridge, feature renderers, command layer, persistence service, and shared editor store into one desktop browser experience. A user opens a `.kml` or `.kmz`, views every supported feature in a local Three.js scene, selects and edits it through commands, saves the same container, and can reopen the result in this editor or Google Earth.

The reference origin used by the desktop preview is a **local rendering convenience only**. The editor must never rewrite coordinates merely because it chose a scene origin. The `IEditorStore` owns the active `IGeoBridge`; therefore the editor reads and uses that bridge, but never changes its anchor or reimplements geographic conversion.

This component is deliberately not AR and not a 2D map. It owns the browser desktop view and orchestration only.

### Boundaries

**It owns**

- DOM layout, accessibility, keyboard/pointer event binding, and visible editor feedback.
- The Three.js `Scene`, camera, lights, WebGL renderer, animation loop, orbit interaction, and resize handling.
- A feature-id to `IFeatureRenderer<…, THREE.Object3D>` scene registry and the deterministic reconciliation of that registry with `document.getFeatures()`.
- Raycast selection, selection highlight, transform/vertex interaction state, and conversion of completed interactions into existing commands.
- Composition lifecycle: create store/persistence/factory, subscribe to the store and persistence status, open through the store, serialize document into the container before a persistence request, and dispose everything in ownership order.
- Desktop replay harnesses and the standalone editor demo.

**It never owns**

- ZIP/KMZ parsing, archive bytes, asset resolution, Blob URL ownership, or KML serialization (`kmz-io`).
- Parsing, feature extraction, insertion/removal, or surgical KML mutation (`kml-model`).
- Geographic/world conversion, origin policy, altitude semantics, or coordinate formatting (`geo-bridge`).
- Feature geometry/material implementation or GPU resources inside individual feature renderers (`renderers`).
- Command semantics, KML mutations, validation, or undo/redo history (`commands`).
- File handles, autosave scheduling, write permission, export, or save status (`persistence`).
- The canonical document/container/selection/command-stack state (`store`).
- GPS, device pose, WebXR session, or AR hit testing (`ar-scene`).

### Contracts consumed

- `IEditorStore` and `EditorState` from `contracts/store.ts`.
- `IKmlDocument`, `IFeatureView`, its discriminated feature variants, and `FeatureType` from `contracts/document-model.ts`.
- `IKmzContainer` and `IAssetProvider` from `contracts/kmz-container.ts`.
- `IFeatureRenderer` and `IRendererFactory` from `contracts/renderer.ts`.
- `ICommand` and `ICommandStack` from `contracts/commands.ts`.
- `IPersistenceService` and `SaveStatus` from `contracts/persistence.ts`.
- `FeatureId`, `FeatureTemplate`, `WorldPosition`, and feature value types from `contracts/type.ts`.

### Contracts implemented

None. The editor is a composition root and view layer. It uses the existing contracts; it must not add a desktop-specific cross-component contract.

### Architectural assumptions

- Components 1–6 and the store are complete and tested before this component is integrated.
- `store.loadFile(file)` atomically exposes a matching document/container and initializes its bridge anchor from the loaded data.
- A command-stack change causes an `IEditorStore` subscription notification after the KML model has mutated.
- `IKmzContainer.setDocKml(document.serialize())` is the required boundary before persistence; persistence saves container bytes and must not inspect the document.
- Renderer instances expose `THREE.Object3D` through their existing generic contract and release their own feature resources in `dispose()`.

## Internal Architecture

Keep browser-specific code at the edge. The only modules that touch Three.js or the DOM are the scene, interaction, and UI modules; calculations return plain values and are unit-tested without WebGL.

```text
EditorApp (composition/lifecycle)
 ├─ EditorShell (DOM panels and status)
 ├─ DesktopScene (camera, WebGL, orbit, frame loop)
 │   ├─ FeatureSceneRegistry (feature ↔ renderer/Object3D reconciliation)
 │   ├─ SelectionPresentation (outline/handles; no model mutation)
 │   └─ RaycastPicker
 ├─ EditInteractionController (pointer gesture → existing ICommand)
 ├─ CommandToolbar / PropertyPanel / FeatureList
 ├─ PersistenceCoordinator (document serialize → container → persistence)
 └─ ReplayHarness (test/demo-only deterministic input)

IEditorStore ─── document/container/selection/commands/geoBridge
IPersistenceService ─── status + write/export
IRendererFactory ─── individual feature renderers
```

### 1. `app.ts` — `EditorApp`

- **Responsibility:** Construct and wire all editor-owned modules; expose a small application lifecycle for the demo; enforce teardown order.
- **Inputs:** A host element and optional internal construction options (test doubles for store, persistence, and renderer factory are allowed only as constructor dependencies, not new public cross-component APIs).
- **Outputs:** Mounted DOM/scene; public `openFile`, `dispose`, and `flushBeforeExit` methods for the demo entry point.
- **Dependencies:** Existing factories `createEditorStore`, `createPersistenceService`, `RendererFactory`, plus editor-local modules.
- **Invariants:** One app owns one store subscription, one persistence-status subscription, one scene, and one active render registry. It never accesses a dependency's private fields. `dispose()` is idempotent.

### 2. `desktop-scene.ts` — `DesktopScene`

- **Responsibility:** Own `THREE.Scene`, perspective camera, `WebGLRenderer`, neutral lighting/grid, orbit controls, canvas mounting, resize observer, and a single `requestAnimationFrame` loop.
- **Inputs:** Host element; callbacks supplied by the interaction controller for pointer events.
- **Outputs:** A stable scene root for feature objects; camera and canvas access needed by the picker; render scheduling method.
- **Dependencies:** `three` and `OrbitControls` from `three/examples/jsm/controls/OrbitControls.js`.
- **Invariants:** Feature objects go below `featureRoot`; editor overlays/handles go below `overlayRoot`; neither is mixed with camera/lights. Exactly one frame loop exists. A zero-size host does not produce invalid camera aspect or renderer size.

### 3. `feature-scene-registry.ts` — `FeatureSceneRegistry`

- **Responsibility:** Reconcile the current `IKmlDocument.getFeatures()` list with scene renderers, without taking ownership of their internal resources.
- **Inputs:** Feature list, active `IAssetProvider`, store-owned `IGeoBridge`, and selected id.
- **Outputs:** Added/updated/removed `Object3D`s; a read-only pick lookup from object ancestry to `FeatureId`.
- **Dependencies:** `IRendererFactory<THREE.Object3D>` and `IFeatureRenderer` only.
- **Invariants:** One renderer per current feature id; removed ids are detached and disposed exactly once; unchanged ids retain their renderer to avoid reloading assets; an async update that finishes after removal/load replacement must not reattach itself.
- **Race guard:** Maintain a monotonically increasing registry generation and one per-entry update generation. Capture both before `await renderer.update`; attach/check results only if both still match and the entry remains active.

### 4. `raycast-picker.ts` — `RaycastPicker`

- **Responsibility:** Translate a canvas pointer position into the nearest visible feature id.
- **Inputs:** CSS-pixel pointer coordinates, canvas bounds, camera, feature root, and the registry's ancestry lookup.
- **Outputs:** `FeatureId | null`.
- **Dependencies:** Three.js `Raycaster`; no document mutation or selection state.
- **Invariants:** Coordinates are normalized against the current canvas client rectangle, not backing-buffer size. Objects below `overlayRoot` are excluded so editor handles never select a different feature.

### 5. `interaction-controller.ts` — `EditInteractionController`

- **Responsibility:** Implement desktop selection and gestures. It translates a completed gesture to a command factory call, then invokes only `store.executeCommand(command)`.
- **Inputs:** Picker result, selected feature view, camera/raycast plane, current transform values, and pointer/key events.
- **Outputs:** Selection requests and existing `ICommand`s.
- **Dependencies:** Public command factories, `IEditorStore`, and pure local gesture helpers.
- **Invariants:** A pointer move only updates a temporary visual preview. A document changes once, on pointer-up, via exactly one command. Escape cancels with no command. Lost pointer capture cancels. No gesture writes KML or calls `geoBridge.worldToGeo()` directly—the relevant command owns that mapping.
- **Mode policy:** It.1 has explicit modes: select, move, line-vertex, overlay transform, model transform. A mode incompatible with the selected feature is disabled, never guessed.

### 6. `selection-presentation.ts`

- **Responsibility:** Display selection without modifying feature renderer internals: bounding-box highlight for all selected objects, vertex handles only for selected lines, and transform gizmo visuals only in an active compatible mode.
- **Inputs:** Selected feature/object, camera, and interaction preview state.
- **Outputs:** Objects under `overlayRoot` tagged with their owning `FeatureId` only for controller routing.
- **Dependencies:** Three.js and the current typed feature view.
- **Invariants:** Handles are recreated/updated after document version changes, never persist after deselection/removal, and are excluded from normal feature picking.

### 7. `ui.ts`, `feature-list.ts`, `property-panel.ts`, `command-toolbar.ts`

- **Responsibility:** Render semantic DOM controls: open/export/save status; feature list; selection details; name/description editors; undo/redo; create/delete; explicit editing-mode controls and error region.
- **Inputs:** `EditorState`, active feature views, command-stack capability, persistence status, and editor-local error messages.
- **Outputs:** Calls to `EditorApp`/store methods, never direct component calls.
- **Dependencies:** Browser DOM only; no UI framework in It.1.
- **Invariants:** User-controlled names/descriptions are assigned via `textContent`/form values, never `innerHTML`. Text commits happen on explicit Apply or blur after validation; no command is emitted when value equals the current value. Buttons accurately reflect `canUndo`, `canRedo`, loaded state, and compatible mode.

### 8. `persistence-coordinator.ts`

- **Responsibility:** Bridge a known successful document mutation to persistence without taking over persistence policy.
- **Inputs:** Store notification, active document/container, and `IPersistenceService`.
- **Outputs:** `container.setDocKml(document.serialize())`, followed by `persistence.notifyChange()`.
- **Dependencies:** Only `IKmlDocument`, `IKmzContainer`, and `IPersistenceService` contracts.
- **Invariants:** Runs only when the store's mutation revision changed, never on selection-only updates. It serializes the currently active matching pair once per completed command/undo/redo. A serializer failure records an editor-visible error and does not call `notifyChange()`.
- **Load boundary:** On a new document/container pair it resets its observed revision and does not serialize merely because the file loaded.

### 9. `replay-harness.ts`

- **Responsibility:** Load Task-1 recording fixture events deterministically for desktop E2E tests and the optional demo replay control.
- **Inputs:** Fixture JSON and a clock supplied by the test; no live sensors.
- **Outputs:** Camera/reference marker updates only. It does not alter the store or KML.
- **Invariants:** Equal fixture plus equal virtual-time sequence produces equal camera transforms and event order. Replay is paused/disposed on load switch and app disposal.

This split leaves document mutation, persistence, and rendering implementation behind their contracts. The editor knows which feature is selected and which command to issue, not how any downstream component performs its work.

## Runtime Data Flow

### Initial mount

1. `EditorApp` creates the store, persistence service, renderer factory, DOM shell, and desktop scene.
2. It registers one store subscription and one persistence-status subscription before enabling controls.
3. It renders the empty state: file picker enabled; feature controls disabled; status `idle`.
4. It starts the scene loop and installs resize, keyboard, `beforeunload`, and pointer listeners. `beforeunload` only requests `flush`; it cannot promise an asynchronous browser write will finish, so the UI exposes a Save-now action for deliberate exit.

### Loading

1. User selects a `.kml` or `.kmz`; the UI rejects other extensions before invoking the store and displays a local validation message.
2. The app disables mutation controls and records a load generation.
3. It calls `await store.loadFile(file)`. The store/container/model own reading and parsing.
4. On success, the store subscription supplies the matching document/container. The registry clears prior entries, asks `document.getFeatures()`, and calls `renderer.update(feature, container.getAssetProvider(), store.geoBridge)` for every feature.
5. The scene frames all loaded feature bounds; if nothing is spatially renderable, it shows an empty-scene message and retains a valid default camera.
6. The feature list renders in document order; selection is null; persistence coordinator records the new pair without saving it.
7. On failure, retain the already displayed document/scene, remove loading state, show the error with a retryable open control, and dispose no current session. A temporary container is the store's responsibility.

### Rendering and store reconciliation

1. Every store notification is classified: pair changed, selection changed, or document mutation revision changed (the editor may keep this revision privately because `EditorState` intentionally does not expose it).
2. Pair change performs a full registry replacement; same pair plus mutation performs feature reconciliation; selection-only notification updates list/panel/highlight without renderer asset work.
3. Reconciliation maps each current id to a renderer entry, updates current entries, creates new entries, and disposes missing entries.
4. Async asset/model failures stay localized to the renderer's fallback object; the editor marks that list row with a non-blocking warning and keeps the feature selectable.

### Selection

1. A primary pointer-down with no active edit drag raycasts only `featureRoot`.
2. Picker resolves hit object ancestry to a feature id; the controller calls `store.selectFeature(id)` or `store.selectFeature(null)` for empty scene.
3. Store notification updates feature-list ARIA selection, property panel, highlight, and compatible command controls.
4. Selection does not serialize, save, mutate a feature, or create history.

### Text and structural editing

1. Property panel reads the selected view from `document.getFeatureById` when rendering.
2. On Apply, it compares the draft to current value and creates `createSetNameCommand` or `createSetDescriptionCommand` only if changed.
3. Create buttons construct the minimal existing `FeatureTemplate` at a deterministic default world location (camera target converted by the relevant existing command/template policy; no editor-side KML construction) and call `createCreateFeatureCommand`.
4. Delete asks for a confirmation naming the selected feature, then sends `createDeleteFeatureCommand(selectedId)`. After notification, if the id is absent, the editor clears selection.
5. The editor immediately refreshes document-derived views after every command-stack notification; it never maintains a competing mutable feature copy.

### Spatial editing

1. User selects an explicit compatible mode. The controller displays a preview handle/gizmo but does not edit the renderer's feature object.
2. On drag start it captures pointer, snapshots the selected typed view, and chooses a stable interaction plane through the initially grabbed world point. For line vertices it records the vertex index.
3. Each pointer move raycasts the plane and updates only local preview geometry/transform. Reject non-finite intersections and keep the previous preview.
4. On pointer-up it verifies the selected id and document pair have not changed. It creates the matching existing command factory output and calls `store.executeCommand` once.
5. The command stack mutates the document through its contract; the store notification causes renderer reconciliation; the preview is removed. If execution fails validation, restore the original preview and show an actionable error.

For overlay/model transformations, the editor computes the target `LatLonBox`, altitude/mode, orientation, or scale using pure interaction helpers from the feature's current contract values. It then invokes `createMoveOverlayCommand`, `createScaleOverlayCommand`, `createRotateOverlayCommand`, `createMoveModelCommand`, `createScaleModelCommand`, or `createRotateModelCommand`; it never assigns those values itself.

### Undo, redo, save, and export

1. Toolbar and shortcuts (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, optionally `Ctrl/Cmd+Y`) call `store.commands.undo()`/`redo()` only when the stack permits it. They do not fabricate inverse commands.
2. The stack notification triggers reconciliation and then the persistence coordinator.
3. For any completed mutation, coordinator calls `container.setDocKml(document.serialize())` and `persistence.notifyChange()`. The persistence service debounces and writes according to its contract.
4. Save-now calls `await persistence.flush(store.container)` after first synchronizing the current document string into that container. It does not claim success until status is `saved`.
5. Export calls `persistence.downloadAs(store.container, suggestedName)`; it is visibly labelled Export and never treated as in-place save.
6. `SaveStatus` changes update a live `aria-live` region. `error` keeps the document editable and exposes Retry Save and Export; no edits are discarded.

### Resource disposal and switching files

1. Before a deliberate file switch, request `flush(activeContainer)`; if it fails, offer Cancel Switch, Switch Without Native Save, or Export. Do not silently discard an unsaved document.
2. Once loading the replacement begins, invalidate editor registry generation and cancel active gestures/replay.
3. On successful pair replacement, dispose every old feature renderer, clear overlays, revoke no asset URL directly, and reset UI-local drafts/errors.
4. On app dispose: cancel frame/resize/pointer/replay; unsubscribe store/status listeners; dispose registry then factory/scene; call persistence dispose; finally detach DOM. The store/container disposal remains with its own component lifecycle, not a renderer concern.

## Public Surface

The editor exposes only app-local construction and lifecycle modules. It does not export a new shared contract.

```ts
export class EditorApp {
  constructor(host: HTMLElement);
  openFile(file: File): Promise<void>;
  flushBeforeExit(): Promise<void>;
  dispose(): void;
}

export function mountEditor(host: HTMLElement): EditorApp;
```

`main.ts` in `demos/editor-demo` finds the host, calls `mountEditor`, binds the file-input change event to `openFile`, and calls `dispose` during hot-module disposal. Production embedding may import the same factory; it must not reach into `EditorApp` internals.

Internal classes (`DesktopScene`, `FeatureSceneRegistry`, `EditInteractionController`, `PersistenceCoordinator`, `RaycastPicker`) are exported only where direct unit tests need them. Their constructor types use existing contracts and editor-local plain types; they are not re-exported from a cross-component barrel.

## Algorithms

### Feature reconciliation

**Purpose:** Keep scene objects exactly aligned with the document without re-creating unchanged renderers.

1. Build `nextById` from `document.getFeatures()`; reject duplicate ids as a deterministic document-model integration error.
2. For each existing id absent from `nextById`, detach object, call `dispose`, remove entry.
3. For each feature in document order, create a factory renderer if absent; otherwise reuse entry.
4. Call `update` with feature, asset provider, and store bridge; generation-guard its resolution.
5. Add the object once under `featureRoot` and tag descendants with id through registry-side mapping, not `Object3D.userData` read by foreign components.

Time is `O(F + R)` for `F` current features and `R` removed entries, plus renderer work. Registry maps use `O(F)` references; no feature data is cloned. Asset/model decoding is delegated to renderers.

### Pointer-to-world plane intersection

**Purpose:** Produce stable meter-space drag targets on desktop without GPS or WebXR.

1. Convert client coordinates to normalized device coordinates using the canvas rectangle.
2. Raycast camera through NDC.
3. Intersect a plane fixed at drag start. Move mode uses a horizontal plane through the grabbed point; a constrained axis uses the plane most orthogonal to camera direction that still has a non-zero ray intersection.
4. Reject null, non-finite, or farther-than-configured maximum intersections.
5. Return plain `WorldPosition` for preview/command factory.

Each move is `O(1)`. Near-parallel rays make a plane unstable; freeze the last valid preview until the ray is usable instead of emitting enormous coordinates. Keep world coordinate magnitudes local by using the store bridge's local reference origin; the editor must not round persisted coordinates.

### Click-versus-drag threshold

**Purpose:** Prevent small hand tremors from creating commands.

Record the down position. Start an edit drag only after squared CSS-pixel distance exceeds `6²`; keep threshold as an internal named constant. Click selection remains `O(1)`. Touch/pen use pointer capture and the same threshold. Escape/lost capture produces no command.

### Camera framing

**Purpose:** Make a new document inspectable without changing its geo anchor.

Aggregate finite `Box3` bounds from registry native objects after their first successful updates. Center orbit target on the box center; set camera distance to `radius / tan(fov/2)` multiplied by `1.25`, clamp to `[1 m, 100 km]`, and update near/far planes from radius. If assets are still loading or bounds are empty, retain default view and schedule one bounded reframe after first renderable object; never reframe after user interaction.

This is `O(F)` for loaded objects. Invalid/empty bounds are ignored and warned, not allowed to make camera matrices NaN.

### Overlay/model target derivation

**Purpose:** Transform a visual preview into contract values consumed by existing commands.

- Translation changes the local preview center by world delta. Pure helpers apply that delta consistently to all four overlay corners before producing a `LatLonBox`; rotation is normalized to `[-180, 180)` only for preview math, preserving command-provided finite value semantics.
- Scale multiplies current dimensions by positive factors; factors are clamped to an editor-local minimum of `1e-6` to prevent degenerate geometry and rejected if non-finite.
- Model rotation uses stable Euler order explicitly matching the renderer/contract convention (heading, tilt, roll). Convert gizmo result once, normalize angles for display, and pass a plain `ModelOrientation`.

Helpers are pure and tested against known transforms. Geographic conversion remains inside existing command/bridge behavior. At antimeridian or polar edge cases, the editor does not invent wrapping rules: disable overlay drag/scale with an explanation if the current bridge/model cannot express a valid target.

### Save coalescing

The editor does not implement a second debounce. It serializes exactly once per observed completed mutation and delegates coalescing/versioning/writes to `IPersistenceService.notifyChange()`. This avoids duplicate timers and conflicting save ownership. Serialization is `O(K)` in document text length; it may allocate one string. No byte cache is held.

## State Management

| State | Owner | Lifetime / synchronization |
| --- | --- | --- |
| document, container, selected id, command history, geo bridge | `IEditorStore` | Authoritative session state. Editor observes it; never mirrors it as mutable data. |
| native file handle, dirty/save versions, timer, save status | `IPersistenceService` | Owned and disposed by persistence. Editor only subscribes/calls contract methods. |
| per-feature renderer/object entry | `FeatureSceneRegistry` | Exists while its id is in active document; generation invalidated on pair change; disposed on removal. |
| scene/camera/controls/canvas/frame id | `DesktopScene` | Editor-app lifetime; disposed before DOM removal. |
| selected highlight, gizmo, line handles, drag preview | editor interaction/presentation | Ephemeral; reset on selection, pair change, command completion, Escape, lost capture, and disposal. |
| form draft, active mode, visible error/warning | DOM/editor UI | UI-local only; drafts are invalidated if selected id or document pair changes. |
| replay clock/index/camera marker | replay harness | Test/demo only; never persisted or placed in store. |

The editor derives current feature values on demand from `store.document`; it does not cache editable copies. A store callback can occur synchronously during subscription, so app construction must complete scene/UI creation before subscribing. Event handlers must first check disposed/load-generation flags to ignore stale work.

## Error Strategy

| Failure | Exact editor behavior and recovery |
| --- | --- |
| Unsupported extension / empty file | Do not call `loadFile`; show accepted formats and retain current session. |
| Corrupt KMZ, invalid KML, or model parse error from store | Keep previous loaded session untouched; show file-specific error and Retry. Never create partial scene entries. |
| No feature or no spatial feature | Render empty state/default camera; disable transform/delete/property actions; file can still be exported unchanged. |
| Missing image/model asset | Keep renderer fallback/selectable object; mark row warning with href; never alter KML or remove feature. |
| Renderer async failure/race | Ignore stale generation result; for current result show warning and preserve fallback. Dispose failed temporary object through renderer lifecycle. |
| Ray miss / near-parallel drag / non-finite world point | Keep last valid preview; on release with no valid target cancel without command and show concise hint. |
| Incompatible editing mode | Disable action before drag; keyboard shortcut has no effect and announces why. |
| Command validation or missing/deleted id | Cancel preview, re-read store/document, show command description plus error; do not call persistence. |
| Serialization error | Keep document and dirty visual state, show Save failed; Retry Serialization/Export remain available. Never call `setDocKml` with partial output. |
| Native permission denied, absent handle, or save error | Mirror persistence `error`; preserve editor state, offer Retry Save and Export. Do not report Saved after download/export. |
| Browser loses WebGL context | Pause interactions/frame updates, show reload scene action; rebuild only editor-owned scene/registry from the unchanged store state when context restores. |
| WebGL unavailable | Show clear unsupported-preview message; retain file/open/export controls but disable 3D editing. No WebXR fallback is attempted. |
| Replay fixture malformed | Fail that replay test/demo control deterministically; do not start partial replay or affect file data. |

Errors are reported through a visible `role="alert"` region and retained until superseded or dismissed. Developer diagnostics may include `Error.message` and operation name; they must not expose file contents or stack traces to the normal UI.

## Performance Strategy

- **Rendering:** One scene, camera, renderer, and RAF loop. Renderers own reusable geometry/texture policies. Registry reuse prevents asset reload on selection and ordinary mutations.
- **Incremental work:** Selection-only store events update DOM/highlight only. Document mutations reconcile by id rather than rebuild the whole scene. Pointer moves alter only preview transforms; they create no commands, KML strings, or saves.
- **Large documents:** Feature list uses incremental DOM update in It.1 up to 1,000 entries; above that, render a fixed-height virtualized list with overscan 10. Scene still loads all features because they must remain visible; loading uses batches of 50 per animation frame to keep input responsive.
- **Thousands of features:** Do not add per-feature DOM listeners; use event delegation. Raycast only `featureRoot`; future renderer-level acceleration is renderer-owned. Highlight boxes/handles are created for selection only.
- **Memory:** Registry holds renderer/object references, not duplicate meshes or feature copies. Dispose removed entries promptly. Do not call `getAssetUrl`, create textures, or revoke Blob URLs in the editor.
- **CPU:** Camera framing runs only after load and one bounded post-asset pass. Orbit controls use damping; rendering may remain continuous in It.1 for simplicity. If profiling shows idle cost, change to invalidation-driven renders without changing contracts.
- **Not optimized prematurely:** No worker, offscreen canvas, scene serialization, or editor-specific asset cache. Those increase lifecycle complexity and duplicate responsibilities before profiler evidence.

## Testing Strategy

### Unit tests (Vitest, no WebGL)

- Reconciliation: create/update/remove ordering; id reuse; unchanged renderer reuse; disposal exactly once; stale async update ignored.
- Picker coordinate normalization and object-ancestry id lookup; overlay objects excluded.
- Pure drag intersection, threshold, axis/plane constraints, non-finite rejection, and camera-frame calculations.
- Overlay/model transform helper vectors including zero/negative/non-finite scales, angle normalization, and no mutation of input feature values.
- UI command emission: equal text emits none; selected feature change invalidates draft; incompatible actions disabled; delete confirmation route.
- Persistence coordinator: selection event does nothing; mutation serializes then calls `setDocKml` then `notifyChange`; serialization failure does not notify; pair replacement resets observation.
- Disposal: cancelling pointer capture, subscriptions, frame loop, registry entries, and status listeners is idempotent.

### Contract integration tests

- Use real `createEditorStore`, `RendererFactory`, command factories, and `PersistenceService` fakes through their public exports.
- Open fixtures for each marker, line, overlay, and model; verify document-order list, one render registry entry per id, selectable scene mapping, and compatible controls.
- Execute every command family through UI/controller route; assert changed feature view then undo/redo returns it exactly through the command stack.
- Verify a model/image missing asset is still rendered as selectable fallback and untouched KML is not changed.
- Verify `container.setDocKml(document.serialize())` precedes persistence after execute, undo, and redo—not selection.

### End-to-end / replay tests

- Headless-browser E2E demo: load real Google-Earth fixture, move one marker and one model programmatically through the same pointer/controller path, rename a feature, save/flush, reopen saved output, and assert edits present.
- Strong round-trip assertion: compare every untouched `doc.kml` range according to KML model golden expectation and every untouched asset byte from the original container. Reopen output in the fixture parser/Google Earth compatibility smoke path.
- Feed a Task-1 recording using virtual time; assert identical camera/reference-marker transforms at named timestamps, no phone APIs requested, and replay changes no KML/container data.
- Rapid sequence: drag preview many times, pointer-up once, undo/redo rapidly; assert exactly one command per completed drag and bounded persistence notifications according to completed history events.

### Regression, golden, and property tests

- Golden screenshots for all four feature types, selected state, missing-asset fallback, and empty scene using fixed viewport/camera/fixture. Tolerate only documented renderer-platform pixel variance.
- Regression fixture for a complex KML containing styles, folders, ExtendedData, comments, and KMZ assets: editor opens and re-saves after a single edit without touching unrelated bytes.
- Property tests generate finite pointer coordinates/camera rays: helper output is finite or `null`, never NaN/Infinity; cancellation never produces a command.
- Property tests generate feature-id add/remove/update sequences: registry map equals latest set and no renderer is disposed twice.
- Accessibility tests verify keyboard selection, focus order, disabled-state semantics, live save/error announcements, and no raw description HTML injection.

## Demo

Implement `demos/editor-demo/` as the standalone proof.

The page has: file picker; save-status badge; Save now and Export buttons; feature list; selection/property panel; mode toolbar; undo/redo; an error/warning panel; and the Three.js canvas with orbit instructions. The user can load a fixture, inspect all four feature types, select through scene or list, move a marker, move/add/remove a line vertex, alter an overlay/model transform, rename/describe a feature, create/delete a supported template, undo/redo, save, reopen the saved file, and export it.

An optional deterministic Replay button loads a checked-in Task-1 recording, displays a moving reference marker/camera path, and proves that the desktop environment needs neither a phone nor WebXR. Demo acceptance is: edit two features; observe `saving` then `saved`; reopen saved file in the editor; then open it in Google Earth with unchanged unrelated content/assets retained.

### What the demo proves and how to test it

This is the phone-free proof that the composed product works end to end: it tests loading a real Google Earth `.kml`/`.kmz`, rendering against a local reference origin, command-based editing with undo/redo, and persistence back into a Google-Earth-compatible file. It does **not** test live GPS or WebXR; the Replay control only supplies deterministic recorded movement to the desktop scene.

For the acceptance test, load a checked-in Google Earth fixture containing at least a marker, a model, and packaged assets. Move the marker and model, save, then reopen the written file in the editor and confirm both edited positions. The automated E2E test must additionally compare the resulting `doc.kml` and archive: only the two intended feature regions may differ, while every other KML byte and every untouched asset byte remains identical. Finally open the same saved file in Google Earth; correct placement and intact assets are the user-visible compatibility check.

### How to read demo messages

The demo message area reports the outcome of the last user-visible operation; it is not an activity log and must never claim a successful save before the persistence service has confirmed `saved`.

- **`Loading…` / `Loaded`** means the file was accepted by the store and its features are available for preview and editing. It says nothing about disk persistence.
- **`Preview warning: …`** means one visual renderer failed (for example a missing model asset). The KML feature remains present and selectable; the warning does not mean that the file was changed or damaged.
- **`Could not load …`** means parsing/opening failed. The prior editor session stays open and the user can choose another file.
- **`Choose a .kml or .kmz file`** is local input validation; the file was never passed to the engine.
- **`Saving…` / `Saved`** may only come from `IPersistenceService.status`. `Saved` means the active container bytes were successfully committed by that service; **Export** remains a separate action and is not an in-place save.
- **`Native save requires the pending shared-container session seam`** is a development-blocker message in the current prototype, not a user error: `IEditorStore.loadFile()` and `IPersistenceService.open()` currently create different `IKmzContainer` sessions, so the editor cannot safely ask persistence to write the container that contains the edited document. Preview, selection, commands, and undo/redo work, but the demo must not be used as evidence of save/reopen until the architecture supplies one explicitly shared container session. The message should be removed only after that integration exists and the end-to-end round-trip test passes.

#### Message-to-component diagnosis

| Demo message | Component to inspect | What is not working / first check |
| --- | --- | --- |
| `Choose a .kml or .kmz file` | `editor` | Only editor-side file-input validation rejected the selection. The file was not opened; check input `accept` values and extension validation. |
| `Could not load …` | Usually `store`; then `kmz-io` or `kml-model` | The store could not complete its transactional load. Inspect the original error: archive/file reading points to `kmz-io`; missing/invalid KML or parse failure points to `kml-model`; the editor must retain the previous session. |
| `Preview warning: …` | Usually `renderers`; possibly `kmz-io` or `geo-bridge` | The document loaded, but one feature cannot be drawn. Check the renderer selected for that feature type; an unresolved href/bytes failure belongs to `kmz-io`'s asset provider; implausible placement points to `geo-bridge`. KML data must remain intact. |
| `Saving…` remains indefinitely | `persistence` | A write was scheduled but did not reach a terminal status. Inspect debounce/session-token/write promise handling and the browser File System Access API operation. |
| Save status `error` / permission-denied message | `persistence` | Native write, file-handle permission, serialization handoff, or export failed. Check persistence error type and active-container identity before looking at UI code. |
| `Native save requires the pending shared-container session seam` | `store` + `persistence` composition | This is the known cross-component integration gap: store and persistence each own a different active `IKmzContainer`. No safe round-trip write can occur. Do not debug the renderer or command layer; establish a single shared container session, then prove it with the round-trip E2E test. |
| Edited feature visually reverts or undo/redo has no effect | `commands` first; then `store` | The command was not applied to the document or the store did not notify subscribers. Verify the command stack, the command's `execute`/`undo`, and store mutation notification before inspecting renderer reconciliation. |
| Feature is present in list but cannot be clicked in the scene | `editor` first; then `renderers` | Check the editor raycast/feature-id ancestry mapping. If no native object exists or it has invalid bounds, inspect the responsible renderer. |

## Dependencies

| Dependency | Why it exists | Why alternatives are rejected / assumptions |
| --- | --- | --- |
| `three` (already project dependency) | Scene graph, WebGL renderer, camera, raycasting, math, and `OrbitControls`. | Reusing renderer ecosystem keeps Object3D contract alignment. Do not introduce another 3D engine. Assumes WebGL2/WebGL1-capable desktop browser. |
| `three/examples/jsm/controls/OrbitControls.js` | Desktop orbit/pan/zoom only. | It ships with Three.js and needs no new package. It is not an AR navigation system. |
| Browser DOM, Pointer Events, ResizeObserver, File API | Accessible controls and file selection. | Native APIs avoid UI framework coupling in this small composition component. |
| Existing `@reduxjs/toolkit` transitively through store | Store implementation dependency, not directly used by editor. | Editor consumes `IEditorStore`; it must not dispatch Redux actions or inspect Redux state. |

No new external package is introduced. In particular, no map SDK, GUI toolkit, physics engine, XML/ZIP package, gizmo library, or WebXR library belongs here.

## Risks

1. **Round-trip corruption caused by wrong composition order — Critical.** If the editor saves container bytes before injecting `document.serialize()`, edits appear in UI but disappear on reopen. Detect with the full E2E reopen/golden test. Mitigate with the single `PersistenceCoordinator` and strict call order. Fallback: disable Save after a serialization error; offer export only when a valid serialization was produced.
2. **Renderer lifecycle/async asset races — High.** A model load can finish after a feature/file is gone. Detect with deferred-promise registry tests and load-switch stress tests. Mitigate with pair/entry generations and exactly-once disposal. Fallback: retain placeholder and ignore late result.
3. **Desktop drag semantic mismatch — High.** Transform gizmo movement may map unexpectedly to KML semantics. Detect with known-coordinate command/bridge integration fixtures and visual Golden tests. Mitigate by emitting only existing command factories and constraining modes; fallback to numeric property editing for an affected feature type.
4. **Large KMZ memory/GPU pressure — High.** Models/textures and thousands of objects can exhaust a tab. Detect with stress fixtures and browser performance measurements. Mitigate batching, renderer reuse, visible warning, and disposal. Fallback: load with feature rendering disabled per warned asset while preserving selection/list/KML.
5. **Save permissions and browser shutdown — Medium.** Async writes may fail or not finish on close. Detect through denied-handle/in-flight flush tests. Mitigate visible status, Retry/Export, and pre-switch flush. Fallback: user exports; never promise recovery the browser cannot guarantee.
6. **Store mutation notification cannot distinguish selection from document version through `EditorState` — Medium.** Detect with tests proving no save after selection. Mitigate editor-local observation around all editor-issued commands/undo/redo plus document feature signature reconciliation; do not alter the contract. Fallback: conservatively serialize on a store callback only when document feature signature changes, accepting harmless extra work but no hidden mutation.
7. **Cross-component responsibility leakage — Medium.** Editor code might begin mutating feature fields or asset URLs. Detect in code review and contract-only import tests. Mitigate module boundaries and tests requiring commands for every mutation. Fallback: remove leaked helper and route through existing public command/renderer APIs.

## Milestones

### M1 — Shell and lifecycle

- Create `EditorApp`, semantic DOM shell, `DesktopScene`, resize/disposal behavior, and empty-state demo.
- Test mount/dispose idempotence, zero-size resize, and no WebGL fallback.
- Working state: a phone-free canvas with open control and no component coupling beyond construction.

### M2 — Load, scene registry, and selection

- Wire store load/subscription, registry reconciliation, feature list, raycast picker, camera framing, and highlights.
- Test four feature fixture composition, selection from scene/list, missing asset fallback, and load-switch async race.
- Working state: all supported features display and select, with no edits.

### M3 — Command-driven property and history UI

- Add name/description Apply, create/delete, undo/redo buttons/shortcuts, selection reset rules, and compatible toolbar state.
- Test every UI path emits existing command factories and undo/redo restores views.
- Working state: non-spatial/structural edits occur through history and scene/list update.

### M4 — Desktop spatial interaction

- Implement pure plane/transform helpers, temporary previews, pointer capture, marker/line editing first, then overlay/model mode controls.
- Test geometry helpers and controller cancellation/validation paths; add visual golden fixtures.
- Working state: all It.1 spatial command types can be completed with mouse/trackpad without direct model mutation.

### M5 — Persistence composition and recovery UX

- Add `PersistenceCoordinator`, save status, Save now, export, pre-switch flush choices, and error panel.
- Test order `serialize → setDocKml → notifyChange`, no save on selection, denied-save recovery, and reopen after flush.
- Working state: a successful editor edit is reliably materialized in the active container and delegated to persistence.

### M6 — Replay, E2E, and acceptance demo

- Add replay harness and fixture controls; implement full fixture round-trip E2E and performance/stress coverage.
- Run Google Earth compatibility validation on saved fixtures; document supported browser/WebGL baseline in demo README.
- Working state: standalone desktop editor proves phone-free deterministic composition, edit/history/save/reopen behavior, and byte-faithful preservation owned by the underlying engine.
