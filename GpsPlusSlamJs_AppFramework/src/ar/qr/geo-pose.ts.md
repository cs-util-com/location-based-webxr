# geo-pose.ts

**Purpose:** the one validator for a geo pose (`lat`, `lon`, absolute
`alt`, a NUE unit-quaternion `rotation` and/or a compass `headingDeg`),
shared by the printed code's level file (`qr-level.ts`) and the tour
manifest (`../tour-manifest.ts`). Extracted from `qr-level.ts`'s private
`parseGeo` for the guided-setup plan (2026-09-08) so the two documents
cannot drift on the heading/rotation consistency rule.

## Public API

- `parseGeoPose(value: unknown, options: { path: string; fail: (message) => never }): QrGeoPose`
  - `path` is the document path used verbatim in messages (`"qr.geo"`,
    `"objects[3].geo"`); `fail` builds and throws the caller's error type.
  - Validates `lat ∈ [-90, 90]`, `lon ∈ [-180, 180]`, finite `alt`;
    normalises `headingDeg` into `[0, 360)`; renormalises a `rotation`
    within the shared tolerance (`renormalizeUnitQuaternion`); requires
    heading and/or rotation; when both are present they must agree within
    `HEADING_CONSISTENCY_TOLERANCE_DEG` (2°), and a non-vertical rotation
    with a heading rejects.
- `HEADING_CONSISTENCY_TOLERANCE_DEG = 2`.

## Invariants & assumptions

- The rotation is a unit quaternion in the **NUE GPS-world frame** over the
  QR local axes (see `QrGeoPose` in `qr-gps-vote.ts`); a mislabeled basis is
  a 120° bug, which is why the type and the parser are one.
- Pure; throws only through `fail`, never its own error class. The
  level's "when present" wording for a non-object geo is the level's own
  check, made before delegating; this parser's messages are never
  rewritten.

## Examples

```ts
const geo = parseGeoPose(raw, {
  path: 'objects[0].geo',
  fail: (m) => {
    throw new TourManifestValidationError(m);
  },
});
```

## Tests

- `geo-pose.test.ts` - the path prefix and the caller's error type.
- The rules: `qr-level.test.ts` and `qr-level.property.test.ts` through the
  level's wrapper (messages unchanged), `../tour-manifest.test.ts` and
  `../tour-manifest.property.test.ts` through the manifest.
