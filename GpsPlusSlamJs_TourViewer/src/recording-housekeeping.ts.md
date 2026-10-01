# recording-housekeeping.ts

## Purpose

The page-open housekeeping of the troubleshooting recordings: wire the
orphan offer (`recording-offer.ts`) against the page's OPFS, clean up what
the cleanup bound names, and offer what a killed tab left unsaved - wherever
the recording's controls show (a creator's page, and a visitor's with
`?debug=1`). Plan:
[authoring recording plan](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
§3.1, M1b (and the M1b review, #7). Moved out of `main.ts` so the wiring is
tested in node.

## Public API

- `wireRecordingHousekeeping({ dom, openRoot, locks, contextTag, environment, handOff, canShare, now, describeTime, reveal, saveGuard }): Promise<void>`
  - `dom`: the offer's elements (`RecordingOfferDom`) plus `block`, the
    recording block, whose `data-housekeeping` becomes `done` once the
    page-open check ran, whatever its outcome (the e2e waits for it).
  - `openRoot()`: the OPFS root, or undefined; a rejection counts as none.
  - `locks`: `navigator.locks`, or undefined (nothing is then known held).
  - `contextTag`: the saving page's own tag - the orphan's fallback when its
    actions say neither `tourAuthoring/*` nor `tourViewing/*`.
  - `environment()`: user agent, query-free page url, build stamp - read at
    each save.
  - `handOff`, `canShare`, `now`, `describeTime`, `reveal`, `saveGuard`:
    passed to the offer (see `recording-offer.ts.md`).
  - Resolves when the page-open check is done; never rejects.

## Invariants & assumptions

- **The fallback tag is the saving page's** (M1b review #7). `main.ts`
  passes `recordingTag`, so an orphan with no log action saved from a
  visitor's `?debug=1` page is `tour-viewing`, from a creator's page
  `tour-authoring`. An earlier save's tag and the log actions still come
  first (`packOrphanRecording`).
- **Read-only until it deletes.** The check never creates the recordings
  folder (`openRecordingsDir(root, false)`); it only lists, deletes what
  `tidyRecordings` names, and offers. On a visitor's debug page it runs at
  page open, before any opt-in - it reads and deletes this app's recording
  folders only, and writes nothing.
- **Best effort.** Without OPFS, or when it refuses, nothing is offered and
  the block is still marked done.

## Examples

```ts
void wireRecordingHousekeeping({
  dom: { offer, text, saveButton, dismissButton, discardButton, status, block },
  openRoot: async () => navigator.storage?.getDirectory?.(),
  locks: navigator.locks,
  contextTag: recordingTag,
  environment: () => ({ userAgent, pageUrl, getBuildInfo }),
  handOff: (blob, name) => seams.shareOrDownloadZip(blob, name),
  canShare: () => seams.canShareZip(),
  now: () => new Date(),
  describeTime,
  reveal: () => wizard.revealStep("measure"),
  saveGuard,
});
```

## Tests

`recording-housekeeping.test.ts` (the framework's OPFS mock, the real offer,
folders and zip): an orphan with GPS fixes only, saved through both taps from
a visitor's page, is tagged `tour-viewing` (red before the fix: the page
passed the creator's tag) and from a creator's page `tour-authoring`; without
OPFS the check still marks the block done. End to end:
`playwright-tests/ar-mode.spec.js` ("a recording whose tab was killed ...").
