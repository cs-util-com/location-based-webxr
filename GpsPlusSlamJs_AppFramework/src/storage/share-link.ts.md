# share-link.ts

## Purpose

Rewrites a pasted cloud-storage _share page_ link (Dropbox, GitHub, Google
Drive, OneDrive) to the provider's raw-bytes download URL — the one that
actually supports HTTP Range reads and CORS. Anything unrecognized passes
through byte-identical, so this is safe to call unconditionally on any URL a
user might paste.

## Public API

- `interface NormalizeShareUrlOptions { googleDriveApiKey?: string }`
- `normalizeShareUrl(rawUrl: string, opts?: NormalizeShareUrlOptions): string`

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
- Key-less Google Drive and Dropbox still commonly need a CORS proxy on the
  caller's side even after normalization — this module only fixes the URL
  _shape_, not cross-origin headers.

## Examples

```ts
normalizeShareUrl('https://www.dropbox.com/scl/fi/abc/tour.zip?dl=0');
// → "https://dl.dropboxusercontent.com/scl/fi/abc/tour.zip"

normalizeShareUrl('https://drive.google.com/file/d/ID/view', {
  googleDriveApiKey: 'KEY',
});
// → "https://www.googleapis.com/drive/v3/files/ID?alt=media&key=KEY"
```

## Tests

`share-link.test.ts` — per-provider rewrites (Dropbox scl/legacy/folder,
GitHub blob/raw, Drive with/without API key and both id-param forms, OneDrive
new-style and legacy) plus strict passthrough for six categories of
already-fine URLs.
