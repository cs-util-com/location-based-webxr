# archive-limits.ts

## Purpose

The caps that keep a crafted archive (a zip bomb: kilobytes that inflate to
gigabytes, or a central directory listing millions of entries) from crashing
the page that opens it. Pure values and arithmetic; the reads that enforce
them live in `capped-response-body.ts` (transport) and
`capped-zip-entries.ts` (entry count, inflated bytes). Tour kit plan K0
(`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`,
K-D1 and cold-review finding F1: three SEPARATE caps).

## Public API

- `interface ArchiveLimits { maxArchiveBytes; maxEntries; maxEntryBytes; maxTextEntryBytes; totalRatio; totalFloorBytes; maxTotalBytes }`
- `DEFAULT_ARCHIVE_LIMITS` (frozen): 1 GiB, 20,000 entries, 256 MiB per
  entry, 16 MiB per text entry, total = 10 x the archive size, at least
  64 MiB, at most 2 GiB.
- `resolveArchiveLimits(overrides?)`: defaults plus overrides; throws
  `RangeError` for a cap that is not a positive safe integer (ratio: a
  positive finite number) - a cap of 0, NaN or Infinity is a configuration
  mistake, never a way to disable a guard.
- `totalBytesAllowance(archiveSize, limits?)`: `min(maxTotal, max(floor,
floor(ratio x size)))`; an unusable size (NaN, negative, fractional,
  infinite) gets the floor.
- `type ArchiveLimitKind = 'archive-bytes' | 'entry-count' | 'entry-bytes' | 'total-bytes'`
- `class ArchiveLimitError extends Error { kind; limit; observed }` - the
  message is plain words a visitor can read ("The file is too large to open
  here (the limit is 1.0 GB).").

## The measurement behind the values (2026-10-03)

219 recording zips: the 211 of the primary repo's `TestDataJs` corpus plus
the example recordings. Central-directory metadata only, plus one re-deflate
pass for the ratio.

- Archive size: median 33 MB, p95 150 MB, **max 270 MB**.
- Entries: median 844, p95 2,063, **max 3,465**.
- Largest entry: **7.9 MB** (`sparse/0/points3D.txt`); largest image 516 KB;
  largest JSON 210 KB.
- Total inflated / archive: **1.0** as recorded (the Recorder stores
  entries uncompressed). Re-zipped with deflate throughout (what an OS
  "compress folder" does), the largest recording inflates **3.78x** overall
  and its JSON **10.4x**; smaller ones 1.05x-2.4x.
- Action stream (decompressed JSON the Tour Viewer parses): max **214 MB**.
- No tour content (`tour.json`, `qr/`, `content/`) exists in the corpus yet,
  so `maxEntryBytes` is sized for future video content, not measured.

## The sweep (margin over the measured maximum at each candidate)

- `maxArchiveBytes`: 512 MiB = 2.0x, **1 GiB = 4.0x**, 2 GiB = 7.9x. 512
  MiB leaves too little room for a long walk plus tour media; 2 GiB is past
  what a phone tab holds as one Blob. Reverses if a real recording passes
  ~1 GB (about 4 times the longest walk recorded so far).
- `maxEntries`: 10,000 = 2.9x, **20,000 = 5.8x**, 50,000 = 14x. The
  directory costs about 100 bytes per entry, so 20,000 is about 2 MB of
  directory - cheap. Reverses if recordings start writing one entry per
  frame at a higher rate.
- `maxEntryBytes`: 64 MiB = 8x, **256 MiB = 34x**, 1 GiB. Chosen for a
  minutes-long video entry (K4), not for recordings. Reverses with a tour
  needing a single video file over 256 MB.
- `maxTextEntryBytes`: **16 MiB = 80x** the largest JSON. Text sits on the
  JS heap, so it is the tighter cap.
- `totalRatio`: 4 = 1.06x over the re-deflated worst case (too tight: a
  JSON-heavy re-zip would be refused), **10 = 2.6x**, 32 = 8.5x. Floor 16 /
  **64** / 256 MiB: 64 MiB covers any small hand-made tour whose JSON
  deflates 20x or more. Ceiling **2 GiB** above every allowance a 1 GiB
  archive could need. Reverses if a real tour's whole-archive ratio passes
  10 (a deflated tour that is nearly all JSON, at more than 64 MiB
  inflated).

## Invariants

- Each cap closes its own door: the transport cap bounds the bytes
  fetched; the entry cap bounds the directory walk; the inflated caps bound
  what a deflated entry produces (deflate can reach about 1,000x, so the
  transport cap alone would still allow a terabyte).
- No cap is ever derived from a size the archive DECLARES about itself.

## Tests

`archive-limits.test.ts`: the defaults against the corpus numbers (at least
3x every measured maximum, the largest recording fits even re-deflated), the
allowance floor/ratio/ceiling and a monotonicity property, override
validation, and the plain-words messages.
