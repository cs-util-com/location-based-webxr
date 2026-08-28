# qr-level.ts

**Purpose:** Fetch + defensively validate the QR level file (§8) — Phase 6 of
the [QR-code detection & tracking plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-0806-qr-code-detection-tracking-plan.md).
The printed QR encodes only a URL; the level file carries `physicalSizeM`
(drives the pose solve + size self-check), the absolute `geo` pose (drives the
synthetic vote), and the AR `content`.

Both `physicalSizeM` and `geo` are **optional** (Note 3 of the
[follow-up plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-1219-qr-tracking-generalization-overlay-and-north-followup.md):
flat optionals + capability model). Their **presence** gates capabilities and
the use-cases combine: `geo` present → the GPS vote runs; `physicalSizeM`
present → size is authored (else it must be **measured** first — the Note 4
depth path — before size-dependent features unlock); neither → a
debug/observe or trigger-only level. `qr` itself is still required as an object.

## Public API

- `parseQrLevel(data: unknown): QrLevel` — validate an already-parsed value;
  throws `QrLevelValidationError` with a descriptive message. Heading is
  normalized into `[0, 360)`.
- `fetchQrLevel(url, { fetchImpl?, signal? }): Promise<QrLevel>` — fetch + parse
  - validate; rejects on non-OK response, non-JSON body, network failure, or
    schema violation. `fetchImpl` defaults to global `fetch`.
- `QrLevel`, `QrLevelValidationError`, `FetchLike`, `FetchQrLevelOptions`.

## Invariants & assumptions

- **External, user-authored data → validated at the boundary:** `version`
  finite; `qr` an object. `qr.physicalSizeM`, **when present**, a positive
  finite number (a `0`/negative authored size is a bug, not a "measure instead"
  signal). `qr.geo`, **when present**, fully valid: `lat∈[-90,90]`,
  `lon∈[-180,180]`, `alt` finite, `headingDeg` finite (a partial geo throws —
  it would silently place the vote wrong). Both fields may be absent.
- **`content` is opaque.** The AR content format is an open question (plan §12);
  it is carried through untouched and NOT interpreted here.
- **`qr.geo` is an optional `QrGeoPose`** — when present it feeds
  `buildQrGpsVotes` directly; when absent the controller skips the vote.
- Injected `fetchImpl` keeps the loader unit-testable and lets callers add
  caching/headers; the controller (`qr-tracking-controller.ts`) caches by URL.

## 6-DoF + writer (QR-pose plan 2026-08-25)

- `qr.geo.rotation` (optional): unit quaternion [x,y,z,w], NUE GPS-world
  frame; small norm drift (≤1e-3) renormalizes, worse rejects.
  Renormalization is IDEMPOTENT: a norm already within 1e-12 of 1 passes
  the values through bit-exact (dividing anyway shifts components by a
  last-bit step per parse, which broke the exact serialize→parse
  round-trip — CI property seed on r574).
  `headingDeg` is optional when rotation is present — a floor/ceiling
  code has no honest heading, and geo with NEITHER rejects loudly.
- `serializeQrLevel(level)` — the writer half: re-validates through
  `parseQrLevel` (fail loud, never a broken file) and emits the JSON the
  parser reads. Round-trip property-tested over the whole capability
  lattice (`qr-level.property.test.ts`).
- When BOTH orientation fields are present they must AGREE (2 degrees
  tolerance, and the rotation must be near-vertical for any heading to be
  honest) — a contradictory pair rejects, because a wrong heading read by a
  rotation-unaware consumer mis-places the code silently.
- `qr.mintQuality` (optional, typed `QrMintQuality`): GPS accuracy,
  alignment sample count/RMSE and mint timestamp — validated when present
  so M4 reads real fields, not a convention buried in opaque content. Plus
  the **session-mint** block, for a code minted from a whole recording
  rather than from one live moment: `sightingCount`, `detectionCount`,
  `rotationSpreadDeg`, `translationSpreadM`, `physicalSizeSpreadM`.
  - **Zero is valid for every count and spread** — a code seen in exactly
    one sighting has no cross-sighting disagreement, which is the most
    confident case there is, not an invalid one. Only `gpsAccuracyM` is
    validated as strictly positive.
  - **Anything not in this list is DROPPED, silently**, because
    `serializeQrLevel` re-validates through `parseQrLevel` before
    stringifying. Adding a field to the writer without adding it here
    produces a green round-trip test and an empty field in the file — the
    trap a 2026-08-28 cold review caught. The round-trip test therefore
    asserts each field **by name**.
  - Validation is table-driven (`MINT_QUALITY_FIELDS`) rather than one
    if-block per field; adding a field means adding one row.

## Tests

- `qr-level.test.ts` — valid parse (content preserved, heading normalized),
  the geo-less / size-less / bare-`qr` optional cases, rejection of a
  present-but-invalid size or partial geo and every malformed field; fetch
  success, non-OK, non-JSON, network failure, and propagated schema violation
  (all via an injected fetch).

## Related

- `qr.geo` → [qr-gps-vote.ts.md](qr-gps-vote.ts.md) (`QrGeoPose`).
- Consumed by [qr-tracking-controller.ts.md](qr-tracking-controller.ts.md).
- `FetchLike` is deliberately narrower than `storage/remote-range-byte-source.ts`'s `FetchImpl` (the full `typeof fetch`) - see that sidecar for why the two seams stay separate.
