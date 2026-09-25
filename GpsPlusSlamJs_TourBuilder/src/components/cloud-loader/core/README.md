# cloud-loader / core

Pure, framework-free policy for the cloud-storage tour source (Component 6). No
DOM, no network, no zip.js — every branch is unit-testable in Node against fakes.
The I/O transport that drives these lives in `../view/`.

**2026-08-18:** the byte-transport pieces that had no tour concept —
`ByteSource`/`SwitchableByteSource`, `decideFallback`/`parseContentRangeTotal`,
and `normalizeShareUrl` — moved to the framework
(`gps-plus-slam-app-framework/storage`) as generic, reusable range-read
infrastructure. See `plans/2026-08-18-cloud-loader-framework-extraction-plan.md`.
What's left here is tour-specific.

## Purpose

- **`asset-provider.ts`** — `RefCountedAssetProvider`, the contract's
  `AssetProvider` (D14). Generic over an injected `loadAssetBlob(id)` backing +
  URL minter — zip/range-free, so the same class can back the authoring
  `FilesAssetProvider` (D14d). It owns ref-counting (balanced
  `getAssetUrl`/`release`, one revoke at count 0, concurrent same-id dedupe) and
  the retry policy (transient → bounded backoff; structural → immediate fail —
  distinguished via the framework's `StructuralReadError`; a failed load
  evicts itself so zone re-entry retries fresh).
- **`mime-for-asset.ts`** — `mimeForAsset(filename, type)`: MIME from the
  filename extension (`.ogg` ≠ `.mp3`, `.jpg` ≠ `.png`), with a per-`AssetType`
  default for unknown extensions.
- **`errors.ts`** — `TourLoadError` (fatal load tier, discriminated
  `loadCause`). `TourLoadCause` extends the framework's
  `RangeProbeRejectCause` with the two causes only this component can produce:
  `invalid-tour-json` and `asset-missing-in-zip`.

## Public API

```ts
function mimeForAsset(filename: string, type: AssetType): string;

class RefCountedAssetProvider implements AssetProvider {
  getAssetUrl(id): Promise<string>;
  release(id): void;
}

class TourLoadError extends Error {
  readonly loadCause: TourLoadCause; // RangeProbeRejectCause | "invalid-tour-json" | "asset-missing-in-zip"
}
```

## Invariants

- `RefCountedAssetProvider`: `getAssetUrl`/`release` calls must balance; the URL is
  revoked exactly once, when the ref-count hits 0; one id is loaded once even
  under concurrent/repeat requests.
- The framework's `StructuralReadError` is never retried by
  `RefCountedAssetProvider`; every other backing rejection is.

## Examples

```ts
const provider = new RefCountedAssetProvider({ loadAssetBlob });
const url = await provider.getAssetUrl("knight");
// … use url …
provider.release("knight");
```

## Tests

`asset-provider.test.ts` (mint, revoke, ref-count, dedupe, transient-retry,
structural-immediate, exhaustion+recovery), `mime-for-asset.test.ts` (extension
wins, type default fallback), `errors.test.ts` (typed cause). The moved
byte-transport tests now live in the framework's `src/storage/`
(`byte-source.test.ts`, `range-probe.test.ts`, `share-link.test.ts`).
