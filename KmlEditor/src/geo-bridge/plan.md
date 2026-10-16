# Overview

This component owns the pure geo/world coordinate bridge for the KmlEditor app. It is responsible for converting between KML geographic coordinates and the applications Three.js world coordinate system, and for stable textual formatting of numeric coordinate values.

It is a narrow bridge: it does not parse KML, it does not manage KMZ archives, it does not render anything, it does not own persistence, and it does not own user interaction. It is strictly the coordinate conversion and formatting layer consumed by the command, renderer, and document-model stacks.

## What it owns

- The current world anchor state (`GeoAnchor`).
- The local tangent-plane conversion policy used for geo ↔ world math.
- Altitude mode semantics for `clampToGround`, `relativeToGround`, and `absolute`.
- Stable coordinate string formatting for minimal KML diffs.
- Deterministic, invertible conversion functions exposed through `IGeoBridge`.

## What it never owns

- KML parsing or serialization.
- KMZ/KML file I/O.
- Feature mutation or command execution.
- Rendering or scene graph state.
- Undo/redo history.
- Any browser-specific geolocation or WebXR APIs.

## Contracts it consumes

- `GeoPosition`, `WorldPosition`, `AltitudeMode`, and `GeoAnchor` from `src/contracts/type.ts`.
- `IGeoBridge` from `src/contracts/geo-bridge.ts`.

## Contracts it implements

- `IGeoBridge` exactly, without modifying the contract.

# Internal Architecture

The implementation is intentionally small and purely functional except for one mutable state object: the current anchor.

## Modules

### `src/geo-bridge/index.ts`
- Exports `createGeoBridge()`.
- Exposes the concrete `IGeoBridge` implementation.
- Keeps the public surface minimal.

### `src/geo-bridge/impl.ts`
- Contains `GeoBridgeImpl`.
- Owns the mutable `anchor` state.
- Delegates conversions and formatting to pure helpers.

### `src/geo-bridge/math.ts`
- Contains all geodetic math.
- Implements local ENU conversion, anchor rotation, and inverse transforms.
- Contains the exact formulas for meters-per-degree at the anchor latitude.

### `src/geo-bridge/altitude-policy.ts`
- Encodes the altitude mode rules.
- Normalizes world-space Y and geo-altitude values based on mode.
- Ensures `clampToGround` does not silently preserve a nonzero height.

### `src/geo-bridge/format.ts`
- Implements stable coordinate formatting.
- Preserves the original string when the numeric value is equivalent.
- Otherwise produces a normalized string with fixed precision and trimmed trailing zeros.

### `src/geo-bridge/errors.ts`
- Defines `GeoBridgeError`, `AnchorNotSetError`, and `InvalidGeoPositionError`.
- Makes recovery behavior explicit.

## Responsibilities and dependencies

- `GeoBridgeImpl`
  - Responsibility: maintain anchor and expose contract methods.
  - Inputs: `GeoAnchor`, `GeoPosition`, `WorldPosition`, `AltitudeMode`.
  - Outputs: `WorldPosition`, `GeoPosition`, stable coordinate strings.
  - Dependencies: `math.ts`, `altitude-policy.ts`, `format.ts`, `errors.ts`.
  - Invariants:
    - After `setAnchor`, `geoToWorld(worldToGeo(world, mode), mode)` is stable within numerical tolerance.
    - `formatCoordinate(value, originalString)` returns `originalString` when the numeric values are semantically equal.

- `math.ts`
  - Responsibility: deterministic local projection and rotation.
  - Inputs: anchor geo position, target geo position, target world position, heading.
  - Outputs: ENU vectors and rotated world vectors.
  - Dependencies: none.
  - Invariants:
    - The transform is invertible on the relevant local range.
    - The local tangent-plane approximation uses anchor latitude and is self-consistent.

- `altitude-policy.ts`
  - Responsibility: implement explicit semantics for KML altitude modes.
  - Inputs: `GeoPosition.alt`, world Y, anchor altitude, selected `AltitudeMode`.
  - Outputs: adjusted world Y or geo alt.
  - Invariants:
    - `clampToGround` always outputs world Y = 0.
    - `relativeToGround` preserves world Y as height above anchor ground.
    - `absolute` preserves height relative to anchor altitude origin.

- `format.ts`
  - Responsibility: avoid unnecessary textual churn in KML coordinate strings.
  - Inputs: numeric value, optional original string.
  - Outputs: canonical string.
  - Invariants:
    - If `value` equals numeric parse of `originalString` within `1e-9`, return `originalString`.
    - Otherwise, return a compact fixed-point representation without scientific notation.

## Why this decomposition minimizes coupling

- The only mutable state is the anchor. This keeps the component easy to reason about and prevents hidden dependencies on render state or command history.
- The pure math helpers are reusable, testable, and do not import any application-specific modules.
- `format.ts` is separated so text formatting policy can evolve independently from spatial math.
- `altitude-policy.ts` contains the Google Earth-specific decision points, so the rest of the bridge can remain plain linear algebra.

# Runtime Data Flow

## Set anchor / initialize

1. The app constructs `IGeoBridge` via `createGeoBridge()`.
2. The upper layer calls `setAnchor(anchor)` once a world origin is chosen.
3. `GeoBridgeImpl` stores the anchor and derives cached constants:
   - `anchorLatRad`
   - `metersPerDegreeLatitude`
   - `metersPerDegreeLongitude`
   - `cosAnchorLat`
   - `sinAnchorLat`
4. Any existing world conversions are now valid for the current anchor.

## Loading a scene

1. The editor or AR loader chooses a reference anchor.
2. The app calls `setAnchor(anchor)` before any geometry conversion.
3. Renderers and commands use `geoToWorld()` to convert feature geo positions into scene positions.
4. The bridge does not retain feature state; it converts on demand.

## Rendering / spatial lookup

1. A renderer requests `geoBridge.geoToWorld(feature.position, feature.altitudeMode)`.
2. The bridge computes a local ENU offset from the anchor and rotates it by the anchor heading.
3. The returned `WorldPosition` is directly usable by scene code.
4. If the renderer needs the inverse, it calls `worldToGeo()` with the same `AltitudeMode`.

## Editing / persistence

1. A UI interaction produces a new world-space position.
2. The command layer calls `geoBridge.worldToGeo(newWorldPosition, feature.altitudeMode)`.
3. The returned `GeoPosition` is stored back into the KML model.
4. If the resulting numeric values are equal to the original KML text, the document-model can preserve the original string.
5. `formatCoordinate()` is used by the document model when serializing changed numeric values.

## Selection and transformations

- Selection itself is outside this component.
- When a selected feature is moved or rotated, the component is only invoked to convert positions and preserve altitude semantics.
- `geo-bridge` does not decide what a drag means; it only converts the final world-space result into geo coordinates.

## Undo / redo

- `geo-bridge` has no undo stack.
- It must be deterministic so undo can rely on the same conversions after the same anchor.
- The component is functionally pure once the anchor is fixed.

## Error handling

- Conversion methods validate input ranges and anchor state before performing math.
- If `setAnchor()` has never been called, both `geoToWorld()` and `worldToGeo()` immediately fail with `AnchorNotSetError`.
- Invalid latitude/longitude values fail with `InvalidGeoPositionError`.
- `formatCoordinate()` never throws for valid numbers; it normalizes them.

# Public Surface

The component exposes a single factory and the `IGeoBridge` implementation.

## `createGeoBridge(): IGeoBridge`
- Returns an object implementing the contract exactly.
- No additional public methods are exposed.

## `IGeoBridge` implementation details

- `setAnchor(anchor: GeoAnchor): void`
  - Stores the anchor.
  - Computes derived local projection constants.
  - Validates that `anchor.position.lat` is in `[-90, 90]` and `anchor.position.lon` is in `[-180, 180]`.

- `geoToWorld(position: GeoPosition, altitudeMode: AltitudeMode = 'clampToGround'): WorldPosition`
  - Validates the input geo position.
  - Converts the geo offset to a local ENU vector using the current anchor.
  - Applies the anchor heading rotation.
  - Applies altitude policy to produce the final `y` coordinate.

- `worldToGeo(position: WorldPosition, altitudeMode: AltitudeMode = 'clampToGround'): GeoPosition`
  - Inverts the anchor rotation.
  - Converts the local ENU vector back to geo degrees.
  - Applies altitude policy to compute the returned altitude.

- `formatCoordinate(value: number, originalString?: string): string`
  - If `originalString` is provided and numerically equivalent, returns `originalString` unchanged.
  - Otherwise returns a stable normalized representation.
  - The function must be safe for both longitude/latitude and altitude values.

# Algorithms

## Local ENU projection

### Purpose

Map a geographic position near the anchor to a local east/north/up Cartesian offset.

### Steps

1. Normalize longitude delta across the antimeridian.
2. Compute anchor latitude in radians.
3. Compute meters-per-degree using a WGS84-inspired local formula:
   - `mLat = 111132.954 - 559.822 * cos(2φ) + 1.175 * cos(4φ)`
   - `mLon = 111412.84 * cos(φ) - 93.5 * cos(3φ)`
4. Compute numeric deltas:
   - `deltaLat = position.lat - anchor.position.lat`
   - `deltaLon = normalizeLonDelta(position.lon - anchor.position.lon)`
   - `east = deltaLon * mLon`
   - `north = deltaLat * mLat`

### Complexity

O(1) per conversion.

### Failure cases

- Anchor latitude outside valid range.
- Longitude delta not normalized.
- Positions far from the anchor degrade the local approximation.

### Numerical issues

- Use double precision.
- Normalize angles in radians.
- Avoid subtractive cancellation by computing deltas in degrees before scaling.

## Anchor rotation

### Purpose

Bridge the local ENU frame to the application world frame, honoring the anchor heading.

### Steps

1. Interpret heading as clockwise from north.
2. Rotate the local ENU vector by `-heading` around the Y axis.
3. Use the same rotation for both directions:
   - `geoToWorld` uses `rotateY(-heading)`.
   - `worldToGeo` uses `rotateY(+heading)`.

### World axis policy

- `world.x` corresponds to local east after rotation.
- `world.y` is up.
- `world.z` corresponds to local north after rotation.

### Complexity

O(1) per conversion.

### Failure cases

- Incorrect sign convention for heading.
- Off-by-90-degree orientation bugs.

### Mitigation

- Use unit tests with explicit samples: north-only, east-only, and a 90° heading case.

## Altitude mode policy

### Purpose

Decode KML altitude semantics into world-space vertical placement.

### Decision rules

- `clampToGround`
  - World Y is forced to `0`.
  - `worldToGeo` returns `alt = 0`.
  - This reflects the KML semantics that the feature is anchored to terrain and has no stored height.

- `relativeToGround`
  - World Y is equal to `geo.alt`.
  - `worldToGeo` returns `alt = position.y`.
  - The anchor ground plane is the world origin.

- `absolute`
  - World Y equals `geo.alt - anchor.position.alt`.
  - `worldToGeo` returns `alt = position.y + anchor.position.alt`.
  - This preserves altitude relative to the anchor reference altitude.

### Edge cases

- If the anchor altitude is missing or zero, `absolute` and `relativeToGround` collapse to the same mapping, but the choice remains explicit.
- `clampToGround` cannot recover an original nonzero altitude; it intentionally drops it to preserve KML semantics.

## Stable formatting

### Purpose

Prevent KML diffs from changing every coordinate string when a feature is edited or preserved.

### Steps

1. If `originalString` exists, parse it to a number.
2. If `value` and parsed original differ by less than `1e-9`, return `originalString`.
3. Otherwise format with a stable rule:
   - Use up to 9 decimal places for latitude/longitude.
   - Use up to 3 decimal places for altitude, unless the absolute magnitude requires more.
   - Trim trailing zeros and a trailing decimal point.
   - Do not emit scientific notation.

### Complexity

O(1) per formatted value.

### Failure cases

- `originalString` is not a valid number.
- `value` is NaN or infinite.

### Recovery

- If `originalString` cannot be parsed, discard it and return the normalized value.
- If `value` is invalid, propagate a `RangeError`.

# Projection contexts and anchor ownership

`IGeoBridge` deliberately represents one local projection with one anchor. An anchor
is a coordinate origin, not permanent KML metadata. The application has two uses of
that projection: document editing/preview and a live AR session.

Do not add two selectable anchors to one `GeoBridgeImpl`: every renderer, command,
and drag operation could accidentally choose the wrong frame. Instead, the higher
composition layer owns separate bridge instances (or equivalent clearly separated
projection contexts):

1. The editor projection uses an anchor derived from the loaded document and is used
   only for editor and desktop-preview work.
2. A live AR session receives a separate projection anchored at its first accurate
   GPS fix. It remains stable until that session ends.
3. Within AR, renderers and `worldToGeo()` use only the session projection. The
   session projection is discarded when AR stops.
4. KML remains absolute WGS84 data. No projection anchor is persisted into it.

The local ENU formula is deliberately a near-anchor approximation. A caller that
renders AR must apply a range check before asking this component to make local
Three.js coordinates for features in another city or country. GeoBridge remains pure:
it owns no GPS watches, WebXR state, or Three.js visibility decisions.

# State Management

This component owns exactly one mutable state object: the current `GeoAnchor` and its derived constants.

## Owned state

- `anchor: GeoAnchor | null`
- `cachedLatRad: number`
- `cachedMetersPerDegreeLatitude: number`
- `cachedMetersPerDegreeLongitude: number`
- `cachedHeadingRad: number`

## Lifetime

- The state is created when `createGeoBridge()` is called.
- It remains valid until the bridge instance is discarded.
- `setAnchor()` may be called multiple times; each call resets the derived constants.

## Synchronization rules

- All methods are synchronous.
- There is no asynchronous invalidation.
- `geoToWorld()` and `worldToGeo()` always read the latest anchor state.
- If the anchor changes, callers must re-run any cached world positions.

## Disposal

- There is no special disposal protocol.
- The object is lightweight and can be garbage-collected once no longer referenced.

## Caching and invalidation

- Only anchor-derived constants are cached.
- No feature-level or history cache is maintained.
- Caches are invalidated by `setAnchor()`.

# Error Strategy

The component exposes explicit errors and does not rely on generic failure behavior.

## Expected failures

- `AnchorNotSetError`
  - When `geoToWorld()` or `worldToGeo()` is called before `setAnchor()`.
  - Recovery: the caller must choose and set an anchor before using the bridge.

- `InvalidGeoPositionError`
  - When latitude is outside `[-90, 90]` or longitude is outside `[-180, 180]`.
  - Recovery: reject the invalid input at the command or model layer before the bridge is invoked.

- `InvalidWorldPositionError`
  - When `worldToGeo()` receives `NaN` or infinite coordinates.
  - Recovery: treat as a programming error; the caller must supply valid world coordinates.

- `InvalidCoordinateFormatError` (internal only)
  - If `formatCoordinate()` is given a non-numeric value.
  - Recovery: normalize to a canonical numeric string or fail fast in tests.

## Exact recovery behavior

- If the anchor is missing, throw `AnchorNotSetError` immediately.
- If the geo position is invalid, throw `InvalidGeoPositionError` immediately.
- For invalid formatting input, use a fallback normalized serialization rather than returning an invalid string.
- Never swallow an invalid anchor or invalid numeric input silently.

# Performance Strategy

This component is intentionally cheap and not a performance bottleneck.

## Memory

- Memory usage is constant and minimal.
- No large arrays, no document graphs, no retained feature state.

## CPU

- Each conversion is O(1).
- The only work is a handful of trig operations and a few multiplications.
- `formatCoordinate()` is also O(1).

## Large files / thousands of features

- The component does not iterate over all features by itself.
- It is called on demand by renderers and commands.
- Its cost is proportional to the number of conversions the rest of the app requests.

## Incremental updates

- There is no global invalidation beyond the anchor.
- When a feature moves, only that feature is converted.
- `setAnchor()` recomputes only the cached projection constants.

## Lazy loading

- Not applicable; the component is already fully lazy and stateless per conversion.

## Object reuse / garbage generation

- Use plain objects for `WorldPosition`/`GeoPosition`.
- Avoid internal intermediate allocs by reusing temporary local variables within functions.
- Do not cache `WorldPosition` objects across calls; the caller owns the returned object.

# Testing Strategy

A complete hierarchy of deterministic unit tests proves the bridge.

## Unit tests

- `setAnchor()`
  - valid anchors store derived constants.
  - invalid anchors throw.

- `geoToWorld()`
  - same position as anchor returns `{x:0,y:0,z:0}` for `clampToGround`.
  - north-only delta maps to positive world Z when heading = 0.
  - east-only delta maps to positive world X when heading = 0.
  - heading = 90 rotates north into world +X.
  - `clampToGround` y is always `0`.
  - `relativeToGround` y equals altitude.
  - `absolute` y equals altitude difference from anchor.

- `worldToGeo()`
  - round-trip of a known world point returns the original geo position within tolerance.
  - heading inversion is correct.
  - altitude mode reverse mapping matches the forward rules.

- `formatCoordinate()`
  - returns the original string when numeric value is identical.
  - trims trailing zeros.
  - does not use scientific notation.
  - normalizes `-0` to `0`.

- error cases
  - conversions before anchor throw.
  - invalid geo values throw.

## Integration tests

- anchor change invalidates derived projection constants.
- `geoToWorld(worldToGeo(point, mode), mode)` is stable within `1e-6` meters for representative points.

## Regression tests

- explicit anchor heading cases.
- altitude mode transitions.
- formatting stability when original strings differ only by trailing zeros.

## Edge cases

- longitude wrapping across the antimeridian.
- latitude and longitude at exact boundary values.
- zero-valued altitudes.

# Demo

The standalone demo for this component is a small browser page that proves its pure conversion behavior.

## Demo requirements

- A form to set a `GeoAnchor`.
- Inputs for a geo coordinate triple (`lon`, `lat`, `alt`).
- A dropdown for `AltitudeMode`.
- A display of the resulting `WorldPosition`.
- A second input for a `WorldPosition` and a button to convert back to geo.
- A simple debug view that renders a handful of hard-coded geo points as dots in a minimal Three.js scene, showing the anchor origin and the rotated axes.

## What the demo proves

- Anchor-based conversion is deterministic.
- Heading orientation is correct.
- Altitude mode semantics are visible.
- The same component code can be reused by the editor and AR scenes.

# Dependencies

- No new runtime dependencies.
- The component uses only built-in TypeScript / JavaScript math.
- It consumes exactly the shared contract types from `src/contracts`.

## Why no third-party geodesy library

- The requirements demand a pure, deterministic bridge with no hidden coupling.
- The local tangent-plane math is simple enough to implement correctly for AR-scale scenes.
- Avoiding an external dependency keeps the component lightweight and testable.

# Risks

## 1. Heading / axis convention mismatch

- Why risky: A wrong sign or axis choice would place every feature incorrectly in the world.
- Detection: unit tests with explicit north/east/90-degree cases and a visible demo.
- Mitigation: choose a single documented convention and lock it in tests.
- Fallback: if the math proves wrong, adjust only `math.ts` and keep the public API unchanged.

## 2. Altitude mode semantics ambiguity

- Why risky: `clampToGround` and `absolute` are often confused in KML.
- Detection: test cases covering all three modes and a manual demo.
- Mitigation: document the chosen policy clearly in this plan and in `altitude-policy.ts`.
- Fallback: if product disagrees, the policy can be revised without changing the contract.

## 3. Precision drift from local projection

- Why risky: long distances from the anchor degrade the ENU approximation.
- Detection: tests against known delta values and review of target scene scale.
- Mitigation: explicitly document the local-range assumption and keep scenes anchored near the chosen origin.
- Fallback: if needed later, replace the projection formulas with a more exact geodesic library behind the same interface.

## 4. Anchor state lifecycle confusion

- Why risky: calling conversions before `setAnchor()` produces bad output.
- Detection: explicit error tests.
- Mitigation: `AnchorNotSetError` and guard the upper layers so they never call conversions early.
- Fallback: no fallback; this is a hard contract precondition.

## 5. Document-anchor / session-anchor confusion

- Why risky: A KML loader can set a document-centered anchor before AR begins. If the
  first device GPS fix is accepted only when `anchor === null`, a far-away document
  anchor is incorrectly reused as the local AR origin.
- Detection: integration test with a KML in Aachen and the first AR GPS fix in
  Gothenburg. The active AR projection must use Gothenburg and no Aachen feature may
  be visible within the local AR radius.
- Mitigation: separate projection contexts; first valid session fix always initializes
  the AR projection; reject out-of-range features before local projection.
- Fallback: do not start live AR, and show a clear HUD message, if no usable GPS fix
  arrives in a reasonable timeout.

# Milestones

## Milestone 1: Bridge skeleton and contract compliance

- Add `src/geo-bridge/index.ts`, `impl.ts`, `math.ts`, `altitude-policy.ts`, `format.ts`, and `errors.ts`.
- Implement `createGeoBridge()`, `setAnchor()`, and the contract methods.
- Add anchor validation and a basic identity conversion test.

## Milestone 2: Local projection and heading rotation

- Implement exact meters-per-degree formulas.
- Implement `geoToWorld()` / `worldToGeo()` with heading.
- Add unit tests for north/east/heading cases.
- Add the simple demo page.

## Milestone 3: Altitude modes and formatting stability

- Implement `clampToGround`, `relativeToGround`, and `absolute` rules.
- Implement `formatCoordinate()` with original-string preservation.
- Add tests for altitude semantics and formatting.

## Milestone 4: Integration and robustness

- Add error tests for missing anchor and invalid geo positions.
- Add regression tests for antimeridian handling.
- Verify the demo with representative points and a manual editor-like scenario.

## Milestone 5: Review and handoff

- Confirm the implementation uses only `src/contracts` types.
- Confirm it does not import any renderer, persistence, or document-model internals.
- Confirm the demo proves the same anchor + conversion behavior that the editor and AR scenes will consume.
