# import-formats.ts

**Purpose:** what a dropped or picked file is to the model import, by its name's extension.

## Public API

- `ImportRole`: `primary` (a `.gltf`, converted), `container` (a `.zip`, which may hold a model), `companion` (`.bin`, `.mtl`, `.tga`, `.bmp`: a part a model names, nothing alone), `picture` (a tour picture, which a model dropped with it may name), `plain` (any other tour file).
- `importRoleOf(name)`: the role, or null for a name without a stem or an extension, or one neither the import nor the tour knows. Reads the last path part, in any letter case.
- `IMPORT_ACCEPT`: the import's extensions with their dots, comma-joined, for a file picker's `accept` beside the tour's own.

## Invariants

- No role claims a tour extension except `picture` and `plain`: a `.glb` stays the tour's own file, and the tour's media allowlist never learns `.gltf`.
- OBJ, STL and FBX are not here yet: they arrive with their converters.

## Tests

`import-formats.test.ts`: every role in any letter case, names it knows nothing of, a property that every tour extension keeps its tour meaning, and the accept list.
