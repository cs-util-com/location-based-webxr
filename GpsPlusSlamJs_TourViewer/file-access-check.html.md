# `file-access-check.html` - what a phone's browser lets the editor do with a file

## Purpose

A standalone check page, linked from nothing, that answers on a real phone
whether the desktop editor's in-place save could work there: the editor
keeps saving into a file the creator chose (`save-target.ts`,
`adoptsSavedFile`), and on Android it does not yet, because no feature
check can tell what decides it. Its result is a log the person running it
takes a screenshot of.

It is a Vite build entry (`vite.config.ts`), so it is built and reachable
on a deployed branch preview at `/tour/file-access-check.html`; nothing in
the Tour Viewer imports it. Its wiring is the page's own inline script, as
`write-probe.html`'s is; the check files and the verdicts are
`src/checks/file-access-check.ts` (unit-tested).

## What it checks, one button each

1. **Save a new file:** `showSaveFilePicker` under a new name
   (`file-access-check-<time>.bin`), a small check file written and read
   back, and the handle kept in IndexedDB.
2. **Reload** the page.
3. **Access after the reload:** the kept handle's `queryPermission`, then
   `requestPermission` (the click is the activation it needs), each answer
   logged, and the file read back and judged.
4. **Rewrite it, and close the tab during the write:** a larger check file
   (20, 50 or 200 MB, written in 1 MB chunks, the progress logged) over the
   kept file through one `createWritable`, while the person closes the tab.
   What was written before and what is being written are kept in
   `localStorage`, so step 5 can name which file it finds.
5. **Read it after reopening:** the file's size, its SHA-256, and the
   verdict: WHOLE (the file before, or the rewrite), CUT SHORT (how much of
   which), DAMAGED, EMPTY, or NOT A CHECK FILE.
6. **Open a file to read and write:** `showOpenFilePicker` with
   `mode: "readwrite"`, the permission logged; only a check file is written
   to (any other file is left as it is).

The page's head line says the browser, its platform (client hints) and
whether each dialog exists.

## Invariants and error handling

- Every step catches its own error and logs it; a button is disabled while
  its step runs.
- The log is kept in `localStorage` (guarded: a private window keeps it for
  the page only), so it survives the reload and the closed tab.
- Only check files are ever written: step 1's new file, the kept file, or
  a file step 6 recognises by its header.

## Tests

`src/checks/file-access-check.test.ts` covers the check files and the
verdicts (every cut of every file told from a whole one, a property). The
page itself runs on the phone it checks; its wiring has no unit test.
