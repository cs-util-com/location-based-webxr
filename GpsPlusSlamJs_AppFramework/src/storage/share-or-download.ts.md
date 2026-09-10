# share-or-download.ts

## Purpose

Hand a file to the device's share sheet when the browser can share FILES,
and fall back to the save-picker-or-anchor download otherwise. The ONE
implementation of that choice for every app in the repository.

## Public API

- `shareOrDownloadBlob(blob, filename, fileType, deps?) -> Promise<ShareOrDownloadResult>`
  - Never rejects for a cancelled share or a dismissed save picker; those
    are `delivered: false`. Rejects only when the DOWNLOAD itself throws,
    which is `downloadBlob`'s existing contract.
- `prefersFileShare(fileType, deps?) -> boolean` - **the question callers
  actually have**, and what a button's label should be chosen from.
- `canShareFilesOfType(fileType, deps?) -> boolean` - the raw CAPABILITY,
  below the policy. Rarely what a caller wants on its own.
- `interface ShareOrDownloadResult { route: 'share' | 'download'; delivered: boolean }`
- `interface ShareOrDownloadDeps { canShare?, share?, download?, coarsePointer? }`
  - the injection seam; every field defaults to the real browser API.

## Invariants & assumptions

- **Two independent questions, not one enum.** `route` decides the copy (a
  share creates a NEW file in the target app; a save replaces one).
  `delivered` decides whether anything left the page at all. `downloadBlob`
  already answered the second for the save picker and the Tour Viewer's
  finish branches on it, so a three-state enum keyed on the route would
  have deleted a distinction the UI depends on.
- **`delivered: false` on the share route does NOT mean "the user
  cancelled."** The Web Share algorithm rejects with `AbortError` both for
  a cancelled sheet and for a failed share; they cannot be told apart. Copy
  built on this must not accuse the user of anything.
- **`delivered: true` on the share route means "handed to the app the user
  picked", and nothing more.** `navigator.share` resolves when the data
  reaches the target and reports nothing about what the target did. Copy
  must not claim the file is in anyone's cloud folder.
- **A non-abort share failure falls back to the download route**, because
  the file is still deliverable that way. Only an abort stops.
- **`canShare` is asked TWICE**: once at wire time with a one-byte dummy
  `File` (there is no real file yet - that is what makes a correct label
  possible), and again with the real file before sharing, because a
  platform may refuse a specific file while allowing its type.
- **The capability is not the policy, and the route follows the POLICY.**
  Windows Chrome and macOS Safari can share files, and their share sheets
  offer Mail and Nearby Share but no "save to disk" - so on a desktop the
  capability says yes while the save picker is the hand-off the user needs,
  especially when the next instruction is "upload this file over the one in
  your cloud folder". `prefersFileShare` is therefore the capability AND a
  coarse primary pointer, and `shareOrDownloadBlob` gates its route on the
  SAME check rather than leaving it to the caller: a caller that forgot
  would produce a button labelled "Download" that opens a share sheet.
  A touchscreen laptop answers yes and still gets a working hand-off, which
  is the cheap direction to be wrong in.
- **Node-safe.** Missing `navigator`, `navigator.share` or `File` all
  resolve to the download route and a `false` capability, so the seam layer
  can call the probe during boot.

## Examples

```ts
const label = prefersFileShare(ZIP_FILE_TYPE) ? 'Share' : 'Download';

const { route, delivered } = await shareOrDownloadBlob(
  blob,
  'tour.zip',
  ZIP_FILE_TYPE
);
if (!delivered) status.textContent = 'Nothing left the page - tap again.';
else if (route === 'share') status.textContent = 'Sent to the app you chose.';
else status.textContent = `Saved as tour.zip - the link is unchanged.`;
```

## Tests

`share-or-download.test.ts` drives all four outcomes through `deps`,
because three of them are invisible to an e2e run: a headless browser has
no share sheet. The ones that carry the contract:

- an abort reported as not-delivered WITHOUT falling back to a download;
- a non-abort share failure that DOES fall back;
- the dismissed save picker;
- the re-ask of `canShare` with the real file;
- and that `prefersFileShare` and the route `shareOrDownloadBlob` takes are
  the same decision for every combination of capability and pointer - the
  property that keeps a button's word and its mechanism from disagreeing.

Node-safety is pinned by stubbing away `navigator` and `File`, since the
seam layer calls the probe during boot and a throw there would take out a
page's whole wiring rather than one button's label.
