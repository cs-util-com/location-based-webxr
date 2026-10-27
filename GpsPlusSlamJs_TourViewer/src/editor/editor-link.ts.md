# editor-link.ts

## Purpose

The desktop editor opens a hosted tour from its link (tour editor plan
2026-10-17-1816, W1 step 5). The zip is fetched whole through the viewer's
own transport - the framework's `openRemoteArchive`, so the Drive proxy,
the transport cap and the refusal causes are the viewer's - and handed to
the editor's one open path (`edit-main.ts` `openFile`, then
`editor-open.ts`) as a File. A linked tour is therefore checked, drawn and
saved exactly as a chosen file is.

## Public API

- `fetchTourFile(link, options?): Promise<File>`
  - `link` is trimmed; text that is not an `http:` / `https:` URL throws
    `Error(NOT_A_LINK)` before any request.
  - `options.corsProxyBaseUrl` - the site worker's Drive proxy
    (`drive-proxy-url.ts`; the page passes
    `driveProxyBaseUrl(location.hostname)`).
  - `options.open` - the transport, `openRemoteArchive` by default
    (`OpenArchive`, injected by the unit test); called with `warm: false`.
  - `options.sliceBytes` - for the unit test; the page reads in the
    viewer's default slices (`readArchiveInSlices`).
  - Resolves a `File` of type `application/zip`, named by the link's
    `.zip` name (`archiveFileName`); a Drive link without one
    (`driveFileId`, the framework's one parser) gives
    `tour-<the first 12 characters of its file id>.zip` (r955 review #1:
    every Drive link suggested `tour.zip`, so a second Drive tour's save
    dialog offered the first one's file, a "Replace?" away from writing
    the original over an edited tour); any other link `tour.zip`.
  - Rejects with the transport's `OpenRemoteArchiveError` or a read's own
    error.
- `linkFileName(link): string | null` - the name the fetched file will
  carry (the same rule, of the trimmed link), worked out before any
  request: the save dialog asked for in the open's click suggests it.
  Null for text that is not an http(s) link (the open refuses it and no
  dialog is asked for).
- `linkOpenErrorText(err, link): string` - the dialog's sentence: the
  viewer's `describeOpenError`, except for `cors`, whose viewer text names
  the viewer's "Open the downloaded file" button; here the viewer's first
  sentence (`HOST_REFUSED_TEXT`, shared, M1 review #6) is followed by
  "download the file and choose it above" on its own line (`#open-error`
  keeps line breaks, `white-space: pre-line`).
- `NOT_A_LINK` (the sentence for text that is not a link), `FetchTourOptions`;
  the transport type `OpenArchive` is module-private.

## Invariants & assumptions

- **The download is stopped on every outcome** (`dispose()` in a
  `finally`): no background warm keeps running after the File is built or
  the read failed.
- **No cache.** The editor opens a file to change it; a cached copy would
  be a second source of truth for a tour that is about to be replaced.
- **No file handle.** A tour from a link has no file on this computer, so
  the editor's Save downloads the new copy (as for a dropped file).
- The file name a `Content-Disposition` header carries is not read (the
  viewer reads it, `content-disposition.ts`): a Drive link's file is named
  after the start of its id in the editor's Save. Reading the header is a
  candidate follow-up, not a defect of the open.

## Examples

```ts
const file = await fetchTourFile(linkInput.value, {
  corsProxyBaseUrl: driveProxyBaseUrl(location.hostname),
});
await openFile(file);
```

## Tests

- `editor-link.test.ts` - over a fake transport: every byte in order and
  in slices, the name, `warm: false`, the download stopped after a read
  failure, text that is not a link refused before any request, the
  wording of a refusal, and `linkFileName` (the fetched file's name, a
  Drive link's after its id, null for text that is not a link).
- `playwright-tests/editor-entry.spec.js` - in the real page against the
  e2e archive server: a linked sample tour opens with the dialog busy
  meanwhile, a host that blocks browsers is explained, and text that is
  not a link is refused.
