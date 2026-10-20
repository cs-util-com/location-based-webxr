# debug-bundle.ts

## Purpose

The debug bundle: the walk recording a tour was made from, in a zip of its
own, so the tour file people open does not carry it (debug captures plan
`2026-10-20-1159-debug-captures-and-codes-in-store-plan`, M2 step 2,
decision E2). Both pages build it the same way (the phone's Done step, the
desktop's "Move the debug data out" and "Save the debug data", M2 steps
3-4), and the editor reads one back when the creator adds debug data (M2
step 5). Not wired into any page yet.

A bundle holds:

- the recording's own entries (`recordingEntryNames` of `tour-read-set.ts`:
  `session.json`, `actions/`, the recorded frames in `images/` or the
  legacy `frames/`, the Recorder's `sparse/` and `refPoints/`), byte for
  byte at their paths;
- `debug-bundle.json` at the root:
  `{format: 1, seriesId, tour, file, writtenAt}`;
- `about-this-debug-data.txt` at the root, the note for a person (the
  walk's note of the old "Move the walk out" zip, reworded: debug data, and the
  recorded frames are "debug camera captures", never photos).

## The wrap: kept

A tour wrapped in a folder (`TourSession.manifestWrap`, e.g. `mytour/`)
gives a bundle whose recording entries keep that folder; the identity and
the note go at the root. Reasons:

- The rebuild (`rebuildZipWithEntries`) carries entries byte for byte and
  can only keep or remove them, never rename. Stripping the folder would
  mean reading every frame and writing it again as a new entry - the
  bundle is hundreds of frames, and the rebuild exists to keep that off
  the JS heap.
- Every reader of a recording already tolerates a folder: the session's
  `session.json` by suffix, the framework's action parse by
  `includes("actions/")`, the frames and scan folders by `(^|/)`.
- It is the shape the walk's own zip of "Move the walk out" had, which
  "Move the debug data out" now writes as this bundle.

The reader finds `debug-bundle.json` at the root, under `./`, or under one
or more folders (`.../debug-bundle.json`): a bundle unzipped and zipped
again by an OS's "compress folder" gains a folder.

## Public API

- `debugBundlePlan(entryNames, tour, writtenAt) -> DebugBundlePlan | null`
  - pure. `keep`: the recording's entries in archive order; `remove`: every
    other entry; `added`: the identity and the note; `identity`. Null when
    the archive has no action stream (no walk). A source that already
    carries `debug-bundle.json` or the note (under `./` too) has them
    replaced, not removed (the rebuild refuses a path both removed and
    written). Throws `RangeError` for a `seriesId` the format cannot carry
    or a `writtenAt` outside years 0-9999 (a programmer error: what is
    written must read back).
- `buildDebugBundle(source, tour, {budget?, now?}) -> Promise<DebugBundleBuilt>`
  - `source` is the whole tour or recording zip (the phone: the bytes the
    Finish itself read; the desktop: `session.readWholeArchive()` or the
    newest bytes). Lists it (`zipBlobEntryNames`), plans, rebuilds.
    `{kind: "built", blob, filename, identity}`, or
    `{kind: "refused", reason}` (words) when it carries no recording.
    `budget`: pass the open session's when `source` is its untrusted
    archive, as the Finish does. Throws what the listing and the rebuild
    throw (not a zip, a cap).
- `debugBundleFileName(tourFileName) -> string` - `castle.zip` gives
  `castle-debug.zip` (case-insensitive `.zip`, trimmed); `tour-debug.zip`
  for an empty or missing name. It replaced `walkFileName` (`-walk`)
  when M2 moved the editor's move-out onto the bundle.
- `readDebugBundle(entryNames, readEntry) -> Promise<DebugBundleRead>` -
  never throws. In order:
  - no action stream: `{kind: "refused", code: "no-recording"}`, with or
    without an identity (a bare identity is debug data of nothing);
  - more than one `debug-bundle.json`: `"ambiguous"`;
  - none: `{kind: "recording"}` (a plain Recorder zip, or a tour file that
    carries its walk);
  - one: read through `readEntry` (a failure: `"unreadable"`), its size
    checked before its text (`"too-large"` past 16 KiB), then validated:
    - not JSON, not an object, `format` not a number: `"malformed"`;
    - `format` another number: `"unknown-format"` (a newer writer);
    - `seriesId`, `tour`, `file` must each be present, null or a string;
      `seriesId` base64url, 1-128 characters; `writtenAt` exactly as
      `toISOString` writes it, a real day (`02-30` is refused):
      otherwise `"malformed"`;
    - `tour` or `file` past 512 code points: `"too-large"`;
    - unknown extra keys are ignored.
  - Each refusal carries `reason`, a sentence for the page.
- `bundleMatchesTour(read, tour) -> "this-tour" | "other-tour" | "recording"`
  - pure, plan Q-C:
  - a listed tour and a bundle that names a series: on the series id
    alone;
  - otherwise (an unlisted tour, or a listed tour's bundle saved before it
    was listed, which names no series): `"this-tour"` unless the title AND
    the file name both differ (plan section 10: changed when M2 wired the
    module; such a bundle used to read as `"other-tour"`); a text neither side knows (null) is no match, so two
    untitled, unnamed tours are `"other-tour"`;
  - a plain recording: `"recording"` ("a recording, not saved from this
    tour").
- Types: `DebugBundleTour {seriesId, title, fileName}` (what a bundle is
  saved from, and compared with), `DebugBundleIdentity`, `DebugBundlePlan`,
  `DebugBundleBuilt`, `DebugBundleRead`, `DebugBundleFound` (a read that
  is not a refusal: what `bundleMatchesTour` takes), `BundleMatch`,
  `BuildDebugBundleOptions`. A refusal's `code` union stays module-private
  (nothing outside needs to name it; `DebugBundleRead["code"]` would).

## Invariants

- The selection is `recordingEntryNames`, not a copy of it:
  `recorder-walk-folders.test.ts` ties that rule to the Recorder's zip
  folders, so a new Recorder folder reaches the bundle through one
  decision.
- Text fields are normalised once (`identityText`): trimmed, empty as null,
  clipped to 512 code points and trimmed again. The writer, the reader and
  the matcher all use it, so a long title written clipped still matches
  its tour, and a hand-edited `" Castle "` is that tour.
- Round trip: for any tour and any date in years 0-9999,
  `readDebugBundle` of the written identity gives `plan.identity` back,
  and `bundleMatchesTour` of it with the same tour is `"this-tour"`
  whenever the identity carries any of series, title or file.
- A tour's title is not capped by `tour.json`, so the writer clips rather
  than fails a save; the reader, which sees only files this module or a
  person wrote, refuses an oversized field instead.

## Example

```ts
const built = await buildDebugBundle(
  await session.readWholeArchive(),
  {
    seriesId:
      session.integrity.kind === "listed"
        ? session.integrity.manifest.seriesId
        : null,
    title: manifest.title,
    fileName: savedName,
  },
  { budget: session.budget },
);
if (built.kind === "built") offerDownload(built.blob, built.filename);

const read = await readDebugBundle(names, (n) => readZipBlobEntry(blob, n));
if (read.kind !== "refused") showLine(bundleMatchesTour(read, tourNow));
```

## Tests

- `debug-bundle.test.ts` - on real zips (`packFilesAsZip`,
  `writeStoreZip`, read back with `zip-blob.ts`): a Recorder zip's every
  recording entry byte for byte and nothing else, a wrapped tour's folder
  kept, the identity's fields and the file name, nulls, the note's words,
  no action stream refused, an existing identity replaced, a `./` archive
  written and read back, the writer's `RangeError`s, a long title clipped;
  every refusal of the reader; the matcher's rules.
- `debug-bundle.property.test.ts` - the selection over any archive and
  wrap (every recording entry kept at its path, everything else removed),
  the round trip over any tour and date, and the reader never throwing on
  any `debug-bundle.json` text.
