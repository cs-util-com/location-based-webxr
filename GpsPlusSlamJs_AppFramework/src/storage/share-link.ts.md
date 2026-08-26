# share-link.ts

## Purpose

Rewrites a pasted cloud-storage _share page_ link (Dropbox, GitHub, Google
Drive, OneDrive) to the provider's raw-bytes download URL — the one that
actually supports HTTP Range reads and CORS. Anything unrecognized passes
through byte-identical, so this is safe to call unconditionally on any URL a
user might paste.

## Public API

- `interface NormalizeShareUrlOptions { googleDriveApiKey?: string; corsProxyBaseUrl?: string }`
- `normalizeShareUrl(rawUrl: string, opts?: NormalizeShareUrlOptions): string`
- Drive precedence: **proxy → API key → raw usercontent** (drive-proxy plan
  Rev 2, review finding 7 — an explicitly configured proxy is the
  deliberate, observable path; a later-added key must not silently switch
  Drive onto the never-live-verified `drive/v3` endpoint). With
  `corsProxyBaseUrl` set, `drive.google.com` share links AND
  directly-pasted `drive.usercontent.google.com` links rewrite to
  `<base>?id=<fileId>` (built via `URL`/`searchParams`, so a base carrying
  a query stays valid and the id stays one opaque value).

## Invariants & assumptions

- Returns anything it does not positively recognize **byte-identical** —
  direct URLs, proxy URLs, relative paths, non-URLs. Never throws. This
  includes OneDrive hosts: only positively recognized share shapes (`1drv.ms`
  short links, `onedrive.live.com` with `resid`/`id`/`cid` or `/redir`,
  `/embed`) are wrapped in the shares API; an about/marketing page passes
  through.
- The legacy-OneDrive shares-API token is base64url over the link's **UTF-8
  bytes** (via `utils/qr-payload/{utf8,base64url}` — the repo's one
  implementation of each): bare `btoa` throws on any character outside
  Latin-1.
- Provider quirks (interstitials, CORS behavior, migrated-account URL forms)
  are current as probed against each provider; a provider changing its
  download-URL scheme would need this file updated, not a caller.
- Key-less Google Drive is browser-blocked outright (403 on
  `Sec-Fetch-Site: cross-site`, verified 2026-08-25) — which is what
  `corsProxyBaseUrl` exists for: the site worker's `/api/drive-proxy`
  (`GpsPlusSlamJs_SiteWorker`) fetches server-side, where the block does
  not apply. This module still only fixes the URL _shape_; the proxy is
  where the cross-origin problem is actually solved.

## Examples

```ts
normalizeShareUrl('https://www.dropbox.com/scl/fi/abc/tour.zip?dl=0');
// → "https://dl.dropboxusercontent.com/scl/fi/abc/tour.zip"

normalizeShareUrl('https://drive.google.com/file/d/ID/view', {
  googleDriveApiKey: 'KEY',
});
// → "https://www.googleapis.com/drive/v3/files/ID?alt=media&key=KEY"
```

## Related host knowledge elsewhere

`utils/qr-payload/codec-dictionary.ts` and `utils/qr-payload/qr-launch-url.ts`
carry some of the same provider hosts (raw.githubusercontent, drive.google.com)
in the **inverse** direction — compressing an already-direct asset URL into a
short QR payload, where this module expands a pasted share page into a direct
URL. Different transforms over overlapping host tables; when a provider
changes its URL scheme, check both places.

## Tests

`share-link.test.ts` — per-provider rewrites (Dropbox scl/legacy/folder,
GitHub blob/raw, Drive with/without API key and both id-param forms, OneDrive
new-style and legacy) plus strict passthrough for six categories of
already-fine URLs.
