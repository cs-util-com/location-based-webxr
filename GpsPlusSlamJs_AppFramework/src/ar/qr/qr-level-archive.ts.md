# qr-level-archive.ts

## Purpose

One-line: own the `qr/<id>.json` convention — where a printed code's level
file lives inside a tour or recording archive, and how to read every level out
of one.

The convention used to have two halves in two different places: the reader's
pattern in the tour viewer's session module, and the writer's file name in
that app's DOM code. Nothing tied them together. A second writer — the
recorder's zip contributor — makes that split untenable, because a drift
between the two does not raise an error: the authored level simply becomes
invisible. Decision record:
`GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
§3 M-A.

## Public API

- `qrLevelEntryName(id: string): string` — `<id>` → `qr/<id>.json`.
  - **Throws `TypeError`** for an id that is not a string, is empty, or
    contains anything that could escape the folder (`/`, `\`, `..`,
    whitespace, query characters). The id reaches a zip path, so an
    unexpected value fails loud rather than writing somewhere unintended.
- `qrLevelIdFromEntryName(name: string): string | null` — the inverse; `null`
  when the entry is not a level file.
- `parseQrLevelEntries(entryNames, readText): Promise<Map<string, QrLevel>>`
  - **Input:** every entry name in the archive, and a function reading one
    entry's text by name.
  - **Output:** parsed levels keyed by code id.
  - **Never throws** for archive content reasons.

## Invariants & assumptions

- **Archive-agnostic on purpose.** It takes names plus a reader rather than a
  zip handle, so the zip library stays on the caller's side and this module is
  testable against a plain object.
- **Only matching names are read.** A tour zip also holds photos and an action
  log; scanning their bytes would cost the whole archive on every open. A test
  asserts the reader is called exactly once for one level among unrelated
  entries.
- **The reader is more permissive than the writer.** `qrLevelIdFromEntryName`
  accepts `[\w.-]+` so hand-built and older archives still work, while
  `qrLevelEntryName` only emits ids of that shape — in practice always the
  short hex from `qrCodeId`. The round trip between the two is pinned by a
  test.
- **Nesting does not match**: `[\w.-]+` excludes `/`, so `qr/sub/x.json` is
  not a level.
- **Null-tolerant reading is deliberate.** A corrupt, unparseable or
  unreadable level means "this code has no level", never "this archive is
  broken" — a visitor whose tour holds one bad file must still see the tour.
  The empty `catch` is load-bearing, not an oversight.

## Examples

```ts
// writer (recorder zip contributor)
const name = qrLevelEntryName(await qrCodeId(detectedText));
await addFile(name, new Blob([serializeQrLevel(level)]));

// reader (tour viewer / recorder consumption path)
const levels = await parseQrLevelEntries([...entriesByName.keys()], async (n) =>
  entriesByName.get(n)!.getData(new TextWriter())
);
const level = levels.get(await qrCodeId(detectedText));
```

## Tests

`qr-level-archive.test.ts` — the entry name; the writer/reader round trip; the
unsafe-id rejections (`..`, separators, whitespace, empty, non-string); which
names the reader accepts and rejects (wrong extension, wrong folder, nested,
bare); zero/one/several levels; that non-level entries are never read; and
that a corrupt, invalid or unreadable level is skipped while the good ones
still load.

No fixtures required — the tests build archives as plain name→text maps.
