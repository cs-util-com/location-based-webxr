# open-errors.ts

## Purpose

Plain-language messages for archive-open failures, shared by the open path,
the image-plane loader and the AR entry (flows plan M6 pulled it out of
`main.ts`).

## Public API

- `describeOpenError(err, url?): string` - one sentence per
  `OpenRemoteArchiveError.rejectCause` (`missing`, `corrupt`, `cors`); any
  other cause reads as Drive's refusal when `url` is a Drive URL, else the
  generic "cannot be opened as an archive"; a non-probe error passes its
  message through.
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
