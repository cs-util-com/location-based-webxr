# `write-probe.html` - on-device file write measurement

## Purpose

A standalone measurement page, linked from nothing, that answers one
question on a real phone before saved tours are designed (the scan-pass plan
`GpsPlusSlamJs_Docs/docs/2026-10-05-1240-tour-scan-pass-desktop-editor-and-partial-download-plan.md`,
S0 and S-D5): can a large file be grown in place while it is being read?

It is a Vite build entry (`vite.config.ts`), so it is built and reachable on
a deployed branch preview at `/tour/write-probe.html`; nothing in the Tour
Viewer imports it. It uses no framework code on purpose, so it measures the
browser alone.

## What it measures

- **A picked file** (`showSaveFilePicker`, then `createWritable`): at each
  test size (10, 50, 200, 500 MB, up to the chosen maximum) the time to open
  a writable that keeps the data, write 1 KiB at the end, and close it, three
  times; and whether a reader sees the written bytes before `close()`. The
  file is emptied afterwards (it cannot be deleted from a page).
- **The app's own storage** (the origin-private file system): the same
  `createWritable` measurement, then a sync access handle in a dedicated
  worker: the time to write 1 KiB at the end, read it back and flush.
- Whether each API exists; a missing API is recorded, not an error.

## Output

A JSON object (`probe: 'tour-write-probe-1'`, the user agent, and one block
per measurement) shown in a text box, with "Copy the results" and "Save the
results as a file". The owner sends it back for the plan.

## Invariants and error handling

- Every measurement catches its own error and records `error` instead of
  failing the page; a button is disabled while its run is going.
- Test files are removed (app storage) or emptied (picked file) at the end;
  an interrupted run can leave one behind.
- The page writes up to the chosen maximum size; the default is 200 MB.

## Tests

None: it measures the device it runs on. The same measurement on desktop
Chromium was taken from the session scratchpad probes recorded in the plan's
§3.
