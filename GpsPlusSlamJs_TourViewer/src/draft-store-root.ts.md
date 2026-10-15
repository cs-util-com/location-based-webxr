# draft-store-root.ts

## Purpose

The pages' one way to open a draft namespace in this origin's private file
system (M6 E2c, the E2c plan review #4): lifted from `main.ts`'s inline
wrapper so the phone's creator draft (`creator-draft.ts`, wired in
`main.ts`) and the desktop editor's (`editor/editor-draft.ts`, wired in
`editor/edit-main.ts`) open the same way.

## Public API

- `openDraftStore(nav, key): Promise<DraftFileStore | undefined>` - the
  framework's `openDraftNamespace(root, key)` over
  `nav.storage.getDirectory()`; `undefined` where there is no persistence.
- `DraftStoreNavigator` - the part of `navigator` it reads.

## Invariants & assumptions

- Never rejects: no navigator, no `storage`, no `getDirectory`, a
  rejecting `getDirectory()` (a private window, an embedded WebView, an
  insecure origin) and a refused directory all read as `undefined` - "no
  persistence", which each page says once.
- The namespace is escaped into one directory under `drafts/` by the
  framework (`opfs-draft-store.ts`); the editor's namespaces start with
  `editor:` so they never meet the phone's.

## Examples

```ts
const store = await openDraftStore(navigator, "editor:local-file:0123...");
if (store === undefined) sayNoBackup();
```

## Tests

`draft-store-root.test.ts`: every missing-storage shape is `undefined`; a
rejecting root and a refused directory are `undefined`; a root that
answers opens `drafts/<escaped key>`.
