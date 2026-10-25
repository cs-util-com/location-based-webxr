# `file-access-check.ts` - the file-access check's files and verdicts

## Purpose

The pure part of `file-access-check.html` (the check a phone runs to see
what its browser lets the editor do with a file): the check files it
writes and the verdict on a file read back after a reload or a tab closed
mid-write. A check file says by itself what it should be, so nothing of
what was written has to survive the closed tab.

## Public API

- `CheckFileSpec` - `{ bodyBytes, seed }`: the body's length and a 32-bit
  seed.
- `MAX_BODY_BYTES` - 1 GiB, the largest body a check writes.
- `isCheckFileSpec(spec)` - whether a spec is one the page may write
  (whole numbers, a body up to `MAX_BODY_BYTES`, a 32-bit seed).
- `headerOf(spec)` - the header line `FILE-ACCESS-CHECK-1 <bodyBytes>
<seed>\n` (ASCII); RangeError for a spec it may not write.
- `fileBytes(spec)` - the whole file's length.
- `bodyChunk(spec, offset, length)` - the body's bytes from `offset`, cut
  at the body's end, so a large body is written chunk by chunk; RangeError
  for a negative or fractional offset.
- `checkFile(spec)` - a whole check file in one array (small ones).
- `specOf(bytes)` - the spec a file's header names, or null.
- `judge(bytes)` - the `Verdict`: `whole`, `cut-short` (with
  `bodyBytesRead`), `damaged` (with `firstWrongAt`, a wrong byte or bytes
  past the named length), `empty`, or `foreign` (no header).
- `sizeWords(bytes)` - "812 B", "1.5 KiB", "50.0 MiB"; "an unknown size"
  for a negative or non-finite one.
- `verdictWords(verdict, written)` - the verdict in plain words for the
  log, naming which file it is: the file as it was before the rewrite, the
  rewritten file, or a check file.
- `Interruption` - `"tab"` or `"browser"`: how a rewrite was stopped
  (the tab closed, or the whole browser killed from the recent apps or
  force-stopped). `interruptionWords(kind)` says it for the log;
  `interruptionOf(value)` reads it back from a stored record, null for
  anything that is not exactly one of the two (an older record without
  it, a damaged one).
- `platformWords(nav)` - the platform line for the log: the client
  hints' platform ("none given" without hints), whether the user agent
  names Android, and whether the hints say mobile. Run once with Chrome's
  Desktop site on, it answers whether the hints still say Android while
  the user agent hides it.

## Invariants & assumptions

- The body's byte at each position comes from a stateless 32-bit mix of
  the seed and the position's word index ("lowbias32"), so any chunk is
  made without the bytes before it, and two seeds give different bodies.
- A file is judged by its header alone: a file without one is `foreign`,
  never checked further; a header cut inside its line is no header.
- Pure: no DOM, no storage, no clock.

## Examples

```ts
const spec = { bodyBytes: 50 * 1024 * 1024, seed: 7 };
await writable.write(headerOf(spec));
for (let at = 0; at < spec.bodyBytes; at += MB) {
  await writable.write(bodyChunk(spec, at, MB));
}
// after the tab closed and the page opened again:
verdictWords(judge(bytesReadBack), { after: spec }); // "CUT SHORT: the rewritten file, only ..."
```

## Tests

`file-access-check.test.ts`: the header and the body, chunks equal to one
piece, seeds that differ, refused specs; each verdict, and a property that
every cut of every check file reads as cut short, never as whole; the two
ways of stopping a rewrite in words and read back (anything else null);
the platform line for a desktop-site request, a phone's user agent, and
no facts at all.
