# drive-file-id.ts

## Purpose

The Google Drive file id of a link, in any spelling Drive or this app hands
out - the one parser (Tour Viewer M0c follow-up F3; root `CLAUDE.md`
DEC-H3: shared behaviour lives once, in the framework's `utils/`,
deep-imported).

## Public API

- `driveFileId(link: string | URL, base?: string): string | null` - the
  id from `/file/d/<id>/...` (view, edit, the bare address, any share
  tail), `open?id=` and `uc?id=` on drive.google.com, the usercontent
  download (`drive.usercontent.google.com/download?id=`), the Drive API
  (`www.googleapis.com/drive/v<n>/files/<id>`) and the site worker's proxy
  (`.../api/drive-proxy?id=`, a relative path resolved against `base`);
  null for anything else.

## Invariants & assumptions

- **A returned id is only letters, digits, `-` and `_`** (Drive's own
  alphabet), so it is safe in a path or a query unescaped; anything else is
  null (a property test holds this).
- **Users:** the QR launch URL's short form (`qr-launch-url.ts`), the Tour
  Viewer's print spelling (`print-link.ts`), its step-6 Drive address
  (`qr-author-mode.ts` `driveFileAddress`) and its tour label
  (`tour-session.ts` `tourLabel`).
- **Not used by `storage/share-link.ts`, on purpose:** that rewrite takes
  ANY id and keeps it opaque by encoding it (its "keeps a hostile id opaque"
  test); this parser rejects such an id. Two contracts, both safe.

## Examples

```ts
driveFileId('https://drive.google.com/file/d/ID/view?usp=drivesdk'); // 'ID'
driveFileId('/api/drive-proxy?id=ID', location.href); // 'ID'
driveFileId('https://example.com/?id=ID'); // null
```

## Tests

`drive-file-id.test.ts`: a table of every spelling above, the relative
proxy path with and without a base, the null cases (other hosts, a folder,
no id, an empty id, an id outside the alphabet), a URL object, and a
property that a returned id is always within the alphabet.
