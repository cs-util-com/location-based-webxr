## Overview

The `commands` component owns deterministic edit execution for the KML Editor: undo, redo, and the concrete mutation commands that change the active KML document through the shared contracts. It is intentionally not a UI layer, a persistence layer, or a model layer.

The key architectural decision is that the command stack is document-scoped. Because `ICommandStack.execute(command)` does not accept a document or bridge, the concrete stack must be constructed with the active `IKmlDocument` and `IGeoBridge` already bound into it. When the editor loads a new file, it must discard the old stack and create a new one rather than trying to reuse history across documents.

### What it owns

- Immutable command objects that carry intent and cached undo state.
- The undo/redo stack and its listener notifications.
- The exact mutation and reversal logic for the supported edit operations.
- Validation that a command target still exists and matches the expected feature type.

### What it never owns

- File I/O, KMZ parsing, XML serialization, or byte-faithful document preservation.
- Rendering, scene graph state, selection state, gesture interpretation, or view layout.
- Persistence policy, debouncing, autosave, or handle management.
- Any new cross-component contract.

### Contracts it consumes

- `IKmlDocument` from `src/contracts/document-model.ts`.
- `IGeoBridge` from `src/contracts/geo-bridge.ts`.
- `IFeatureView` and the typed feature views from `src/contracts/document-model.ts`.
- `FeatureTemplate`, `FeatureSnapshot`, `GeoPosition`, `WorldPosition`, `LatLonBox`, `ModelOrientation`, `ModelScale`, and `AltitudeMode` from `src/contracts/type.ts`.

### Contracts it implements

- `ICommand` exactly as declared in `src/contracts/commands.ts`.
- `ICommandStack` exactly as declared in `src/contracts/commands.ts`.

### Explicit boundary

- Selection, pointer events, keyboard shortcuts, and replay input stay in `editor` or `ar-scene`.
- Commands only receive already-decided targets such as feature ids, vertex indices, insertion anchors, and final world-space or geo-space values.

## Internal Architecture

Keep the implementation small. The component should have one stack implementation and a few command families, but it should not be split into many tiny files unless the codebase actually needs that separation.

### `stack.ts`

- Responsibility: implement `ICommandStack`.
- Inputs: `ICommand` instances plus the bound `IKmlDocument` and `IGeoBridge`.
- Outputs: synchronous execute, undo, redo, and change notifications.
- Dependencies: none beyond the contracts and the command instances.
- Invariants:
	- The redo tail is truncated on any successful new execute.
	- Undo/redo are linear cursor moves over one history array.
	- Failed operations do not change the cursor or history.

### `validation.ts`

- Responsibility: resolve a feature by id, verify its type, and validate numeric/index inputs before mutation.
- Inputs: feature ids, expected feature types, vertex indices, and numeric payloads.
- Outputs: validated feature views or explicit failure.
- Dependencies: `IKmlDocument` and the type guards in the contracts.
- Invariants:
	- A missing or stale id fails immediately.
	- `NaN`, `Infinity`, and out-of-range indices are rejected instead of being coerced.

### `text-commands.ts`

- Responsibility: name and description edits.
- Inputs: feature id plus the final string value.
- Outputs: in-place updates of `name` or `description` on the matching feature view.
- Dependencies: `IKmlDocument`.
- Invariants: text commands never touch geometry, style, or document structure.

### `spatial-commands.ts`

- Responsibility: marker, line, overlay, and model geometry edits.
- Inputs: feature id, final geometry payload, and the bound `IGeoBridge` when a world-space value must be converted back to geo.
- Outputs: typed feature mutations through the public feature-view fields.
- Dependencies: `IKmlDocument` and `IGeoBridge`.
- Invariants:
	- Undo restores the exact original typed values captured on first execution.
	- Redo reapplies the stored target payload; it does not recompute intent from the current scene.

### `structural-commands.ts`

- Responsibility: create and delete operations.
- Inputs: `FeatureTemplate`, feature ids, insertion anchors, and delete snapshots.
- Outputs: calls to `insertFeature`, `removeFeature`, and `restoreFeature` on the document model.
- Dependencies: `IKmlDocument`.
- Invariants: the command never parses or rewrites XML itself; the document model remains the structural source of truth.

### `index.ts`

- Responsibility: expose the concrete stack factory and the concrete command factories used by the editor and tests.
- Constraint: this module is a thin public entry point only. It must not become a second implementation layer.

This decomposition minimizes coupling because the stack only knows about generic command objects, the command families only know about the contracts, and validation is shared rather than duplicated. The split should stop there; deeper subdivision only adds maintenance overhead without reducing risk.

## Runtime Data Flow

### Loading

1. The store loads a document and creates or resets the `IKmlDocument` and `IGeoBridge` instances.
2. It creates a fresh command stack bound to those instances.
3. The stack starts empty; no command is replayed during load.

### Editing

1. The UI or replay test constructs an `ICommand` with the final target value.
2. The stack executes the command against the bound document and bridge.
3. The command mutates the document through the public feature-view or document-model API only.
4. On success, the stack appends the command, advances the cursor, and notifies listeners.

### Spatial edits

1. A drag or gizmo interaction is converted by the caller into the final world position, geo position, rotation, scale, or vertex index.
2. Marker and line commands convert world-space back to geo-space only when needed.
3. Overlay and model commands write the final typed fields directly.
4. The command layer does not infer a new gesture meaning from the current scene.

### Selection

- Selection is external. The command layer only receives selected ids as construction input.
- It never stores selection state and it never decides what should become selected next.

### Undo

1. `undo()` moves one step backward in history.
2. The command’s `undo(document, geoBridge)` method runs against the same bound objects.
3. The cursor moves back only after the undo succeeds.
4. If there is nothing to undo, the method returns `null` and leaves state unchanged.

### Redo

1. `redo()` replays the next command in history.
2. The command’s `execute(document, geoBridge)` method runs again against the same bound objects.
3. The cursor advances only after the redo succeeds.
4. If there is nothing to redo, the method returns `null` and leaves state unchanged.

### Structural editing

- Create commands call `insertFeature` with a captured template and optional insertion anchor.
- Delete commands call `removeFeature` and cache the returned snapshot.
- Undo of delete passes the snapshot back to `restoreFeature`.
- The document model stays responsible for exact XML placement.

### Resource disposal

- The stack exposes no explicit dispose contract.
- Lifetime is handled by ownership: the store or editor drops the old stack when the active document is replaced.
- Listeners are removed through the disposer returned from `onChange`.

### Error handling

- A failed command must not partially update the stack.
- If mutation throws, the cursor and history remain unchanged and no change event is emitted.

## Public Surface

The component should expose only what the editor and tests need to instantiate the contract implementations.

### `createCommandStack(document: IKmlDocument, geoBridge: IGeoBridge): ICommandStack`

- This is the only concrete stack constructor the rest of the app should use.
- It binds the active document and bridge at creation time so the contract can remain unchanged.

### Concrete command factories or constructors

- One concrete implementation per command type in `src/contracts/commands.ts`.
- The command instances implement `ICommand` directly.
- Commands should be immutable from the outside, but they may keep private cached undo state.
- Public factories are fine, but they are only instantiation helpers and must not introduce new abstractions.

### Create-feature id rule

- `featureId` must exist on every `ICommand`, including create commands.
- For create commands, the property is not a user-facing identity before the first successful execute; it becomes meaningful only after the document assigns the inserted feature id.
- That behaviour must be documented and tested, because the current contract surface does not provide a separate pre-assigned id channel.

## Algorithms

### History management

- Use a single array plus a cursor.
- Execute appends at the cursor and truncates any redo tail.
- Undo decrements the cursor after successful reversal.
- Redo increments the cursor after successful reapplication.
- Complexity is O(1) for stack operations, excluding document mutation work.

### Validation

- Resolve the target feature by id immediately before mutation.
- Verify the feature type matches the command family.
- Reject invalid numeric payloads and out-of-range indices before any write happens.
- This prevents silent mutation of the wrong feature after reload, undo, or external document replacement.

### Marker move

- Capture the original marker position on first execute.
- Convert the target world position back to geo through `IGeoBridge.worldToGeo`.
- Write the resulting geo position into the marker’s `position` field.
- Undo restores the cached original position directly.
- Complexity is O(1).

### Line vertex move

- Capture the original coordinate array on first execute.
- Replace exactly one vertex at the captured index with the geo position computed from the target world position.
- Write the entire updated coordinate array back.
- Undo restores the cached original array.
- Complexity is O(n) for the line length because the array must be cloned for safe undo.

### Line vertex add/remove

- Add inserts one coordinate at the captured index.
- Remove deletes exactly one coordinate at the captured index.
- Both commands store the full original coordinate array for undo.
- Complexity is O(n) for the line length.

### Overlay move/scale/rotate

- The command family applies the final payload it is given.
- Move updates the overlay location or equivalent box anchor.
- Scale writes a new `LatLonBox`.
- Rotate writes only the final rotation value.
- Undo restores the full original `LatLonBox`, altitude, and `altitudeMode` values as needed.
- The command must not invent a richer transform model than the document contract already exposes.

### Model move/scale/rotate

- Move writes the final `location` only.
- Scale writes the final `ModelScale`.
- Rotate writes the final `ModelOrientation`.
- Undo restores the full original typed values.
- No extra geometry conversion belongs here beyond the geo bridge conversion for the location itself.

### Name/description edits

- Cache the original string.
- Write the new string directly.
- Undo restores the exact original string.
- These commands must not touch coordinate data, style data, or unrelated feature properties.

### Create feature

- Store the template and optional insertion anchor.
- On first execute, call `insertFeature`, capture the returned id, and cache it as the command’s current id.
- On redo after an undo, call `insertFeature` again with the same template and refresh the cached id from the document result.
- This is a deliberate compromise forced by the current document-model contract, and it must be covered by tests.

### Delete feature

- Store the feature id.
- Call `removeFeature` and cache the returned `FeatureSnapshot`.
- Undo passes the same snapshot to `restoreFeature`.
- Redo deletes the same feature again by id.
- The command never parses the snapshot fragment itself.
- The snapshot’s insertion index must be preserved so restoration lands in the same structural location unless the document model requires a different validated anchor.

### Command replay

- Replay is deterministic because each command stores the exact target payload and the original state observed on first execution.
- The command stack never recomputes the user’s intent from current scene state during undo/redo.

### Numerical precision

- Spatial commands do not round or serialize numbers themselves.
- They pass doubles through to the geo bridge or feature view and let the KML model preserve formatting.
- That avoids accidental drift or extra formatting churn.

## State Management

- Stack history is owned by the concrete command stack.
- It consists of a command array, a cursor, and the bound document/bridge references.
- Lifetime matches the loaded document.
- When a new file is loaded, the old stack is dropped rather than cleared.

- Command-local caches are owned by each command instance.
- Examples are the original marker position, the original coordinate array for a line, the original `LatLonBox`, and the `FeatureSnapshot` for deletes.
- Lifetime begins on first execute and lasts until the command is discarded with the history entry.

- Create commands also own the latest inserted id returned by the document model.
- That cached id is document-scoped and must be treated as invalid after reload.

- Listeners are owned by the stack.
- `onChange` registers a call-back and returns a disposer that removes only that call-back.
- The listener set is not shared with any other component.

- Invalidated state is never reused across documents.
- Feature ids, vertex indices, insertion anchors, and cached snapshots are document-specific and must be revalidated on every execute and undo.

- There is no command cache across sessions.
- Command objects are not persisted and are not meant to survive a page reload.

## Error Strategy

- Missing feature id: fail before mutating anything and keep the stack unchanged.
- Wrong feature type: fail early with a typed precondition failure rather than coercing the target.
- Non-finite numbers or out-of-range indices: reject the command before any write happens.
- Stale feature reference after reload or external mutation: fail fast and surface the error to the caller.
- Geo bridge not initialized: surface the bridge failure unchanged.
- Create-feature insertion conflict: if the document model rejects the insertion anchor or template, the command fails and the stack remains unchanged.
- Delete-feature undo conflict: if `restoreFeature` cannot reinsert the snapshot, the command fails and the stack cursor stays where it was before the undo attempt.
- Undo or redo at the boundary: return `null` and do nothing.
- Listener failure: stack state stays intact because notification happens after the mutation is committed.

## Performance Strategy

- History operations are O(1) except for the document work performed by the command.
- The command layer never serializes the whole document and never clones the full XML string.
- Only touched geometry is copied.
- Marker and text commands store tiny amounts of state.
- Line commands copy the affected coordinate array once because undo correctness matters more than minimizing a few kilobytes of history data.
- Delete commands store the snapshot returned by the document model instead of re-parsing or re-serializing XML in the command layer.
- Create commands keep the original template plus the latest inserted id, not a full document snapshot.
- Listener dispatch is small and synchronous.
- No debouncing belongs here; that is a persistence concern.
- The component does not impose a fixed history cap in v1. If the product later needs one, that should be added as an editor policy, not as hidden behaviour inside command execution.

## Testing Strategy

- Unit tests for the stack: execute pushes commands, undo and redo move the cursor correctly, redo is truncated after a new execute, and `onChange` subscriptions can be removed cleanly.
- Unit tests for each text command: name and description changes update only the intended field and undo restores the original string through the document model.
- Unit tests for each spatial command family: marker move, line vertex move/add/remove, overlay move/scale/rotate, and model move/scale/rotate mutate only the intended typed fields and restore the original values on undo.
- Integration tests with the real `IKmlDocument` and `IGeoBridge` implementations: a command sequence on a real fixture produces the expected typed feature state and the expected serialized diff, without touching unrelated XML.
- Replay tests with recorded movement sequences: feed captured desktop or Task-1 position samples into command construction and verify the same final document state is produced every run.
- Regression tests for create/delete: create followed by delete leaves the document identical to the original; delete followed by undo restores the same feature fragment and the same surrounding XML; multiple undo/redo cycles remain stable.
- Failure tests: invalid ids, wrong feature types, non-finite numbers, out-of-range vertex indices, missing bridge anchor, and rejected structural inserts all fail without advancing stack state.
- Golden tests: compare the serialized output of a scripted command sequence against a known-good KML fixture diff so the command layer cannot introduce unwanted XML churn.
- Create-command tests must explicitly cover the post-execute id update rule.

## Demo

- The standalone demo should live in `demos/commands-demo/index.html` and should run without the rest of the editor.
- It should load a small fixture KML into the real document model, bind a command stack to a real geo bridge, and show a simple feature list with current ids, names, and types.
- The user should be able to trigger at least one command from each family: move a marker, move a line vertex, rename a feature, move or rotate a model, create a new marker, and delete an existing feature.
- The demo should show a live command log and undo/redo controls so the operator can verify the exact sequence of mutations.
- A full 3D editor scene is not required for this component demo; a minimal fixture-driven page is enough as long as it proves the command/state/diff loop.
- What proves it works: the displayed feature state, the serialized KML diff, and the ability to undo and redo every command without losing unrelated data.

## Dependencies

- No new runtime library is required for the component itself.
- The component depends on the shared contracts in `src/contracts/*` and on the concrete `kml-model` and `geo-bridge` implementations delivered earlier in the project order.
- Tests rely on the project test runner already present in the workspace.
- The demo should not take a direct runtime dependency on rendering unless a tiny scene is used for convenience.

## Risks

- Create-feature id stability is the highest risk because `IKmlDocument.insertFeature()` generates ids. Mitigation: cache the latest inserted id inside the command instance and test the post-execute update rule explicitly.
- Spatial drift is a risk if commands recompute intent from the current document instead of using cached original state and final target values. Mitigation: capture the original state on first execute and replay the stored target directly.
- Stale feature references are a risk when commands outlive a reload or external mutation. Mitigation: treat ids, indices, and snapshots as document-scoped and fail fast when validation fails.
- Large line edits can retain more memory than text commands. Mitigation: clone only the affected coordinate arrays and do not snapshot the whole document.
- Listener re-entrancy can create confusing UI updates. Mitigation: keep notifications synchronous and tied only to committed stack changes.
- Non-finite numeric inputs can corrupt the KML output if they are not rejected. Mitigation: validate all numeric payloads before mutation.

## Milestones

1. Build the stack skeleton with bound document and bridge, cursor management, validation hooks, and listener notifications. This is independently testable with no feature commands at all.
2. Implement text commands and the simplest spatial command, marker move. This proves the execute/undo pattern on real document views.
3. Implement line editing and model/overlay transforms, including the original-state caches needed for correct undo.
4. Implement create/delete commands and prove that document snapshots, insertion indexes, and reinsertion behave correctly across undo/redo.
5. Add integration and replay tests against real fixtures, then finish the standalone commands demo with visible diffs and command logs.
6. Freeze the public surface, document the stack lifecycle assumption, and hand the component off to the editor layer.
