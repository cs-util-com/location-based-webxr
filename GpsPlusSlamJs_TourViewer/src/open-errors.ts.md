# open-errors.ts

## Purpose

Plain-language messages for archive-open failures, shared by the open path,
the image-plane loader and the AR entry (flows plan M6 pulled it out of
`main.ts`).

## Public API

- `describeOpenError(err, url?, audience?): string` - for a `"visitor"`
  the `cors` text keeps the download route (their only way in, K-D1)
  but drops the creator's hosting note and names who can fix it ("tell the
  person who put up the poster"; UI round 1, U1); a refused Drive file tells
  a visitor the same instead of the creator's sharing settings (U1 milestone
  review #10). Otherwise one sentence per
  `OpenRemoteArchiveError.rejectCause` (`missing`, `corrupt`, `cors` - with
  the advice "download the file to this device, then tap
  `OPEN_FILE_ADVICE_LABEL` below", tour kit plan K0 - `offline` - "this
  device is offline, and this tour is not saved on it", K0 -
  `too-large` - the carried `ArchiveLimitError`'s own sentence, which names
  the limit, tour kit plan K0); an `ArchiveLimitError` from the zip caps
  passes its plain message through; any
  other cause reads as Drive's refusal when `url` is a Drive URL, else the
  generic "cannot be opened as an archive"; a non-probe error passes its
  message through.
- `HOST_REFUSED_TEXT` - the first sentence of every `cors` wording: the
  creator's error box, the editor's link open (`editor/editor-link.ts`) and
  the "You already have a tour?" box (`have-tour.ts`) each start with it
  and add the way around their own page offers (M1 review #6).
- `describeOpenCause(cause): string | undefined` - the fixed sentence of a
  cause that needs neither the error nor the link (`missing`, `corrupt`,
  `cors`, `offline`), else undefined; for callers that hold only an
  outcome's cause.
- `describeIntegrityError(err: TourIntegrityError): string` (tour kit plan
  K1, §4.2) - "does not match its own list of contents, so it is not
  shown ... Do not trust this copy", with the technical detail at the
  end; for `newer-format` instead "made with a newer version of the app,
  reload to update" (not modified, just not checkable here).
  `describeOpenError` delegates to it.
- `olderFormatRefusal(err: TourManifestOlderFormatError, draftDeleted):
string` - a tour of a format this app no longer opens (versions 1 to
  3): "This tour is in an older format (version N) that this version of
  the app no longer opens; it has to be made again.", with ", and its
  unsaved changes cannot be restored" before the full stop when the
  refusal deleted the draft this device held for it (the phone's archive
  open, `archive-open.ts`; the editor's open, `editor/edit-main.ts`).
- `offersFileOpen(cause): boolean` - true for `cors` only: the page shows
  the "Open the downloaded file" button under the error. Offline a
  download is impossible too; a missing, broken or too-large file is not
  fixed by downloading it. `OPEN_FILE_ADVICE_LABEL` is that button's label,
  named in the advice so the two cannot drift.
- `isDriveUrl(url, base = location.href): boolean` - the share page, the
  raw download host, the site worker's `/api/drive-proxy` route, or the
  Drive API form (`www.googleapis.com/drive/…`) that a configured
  `googleDriveApiKey` normalises to. A malformed URL is `false`, never a
  throw. The finish step's Drive route (save, Drive steps) reads it on the
  normalised url, so every form a Drive link can take belongs here.

## Invariants & assumptions

- The Drive-aware default branch exists because a refused Drive file used
  to read as the generic archive error and hide the cause (drive-proxy plan
  Rev 2, review finding 12).
- `cors` versus `offline` (tour kit plan K0): both are a fetch that failed
  before any HTTP status, which a browser reports identically. The
  framework tries the saved copy FIRST and calls it `offline` only when
  `navigator.onLine` is false (reliable in that direction; `true` is not -
  a captive portal is "online"), so the download advice is only ever shown
  without a saved copy and with a network the browser believes in. A
  dropped connection while "online" still reads as `cors`; the wording
  names that possibility.
- Pure: no DOM, no fetch.

## Examples

```ts
describeOpenError(new OpenRemoteArchiveError("x", "missing"));
// "That file does not exist (the link may have expired or been deleted)."
```

## Tests

`open-errors.test.ts` - every cause, the Drive branch for all three Drive
URL forms, the generic and pass-through branches, and the malformed-URL
guard.
