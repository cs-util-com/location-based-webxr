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
`write-probe.html`'s is; the check files, the verdicts and the log's
words are `src/checks/file-access-check.ts` (unit-tested).

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
   What was written before, what is being written, and the way the write
   is to be stopped (`way: "tab"`) are kept in `localStorage`, so step 5
   can name which file it finds and how the write before it ended.
5. **Read it after reopening:** how the last rewrite was stopped (from
   the record; "no rewrite is recorded" without one), the file's size, its
   SHA-256, and the verdict: WHOLE (the file before, or the rewrite), CUT
   SHORT (how much of which), DAMAGED, EMPTY, or NOT A CHECK FILE.
6. **Rewrite again, and close the whole browser:** step 4's rewrite, but
   the person kills the browser - swiped away from the recent apps, or
   Force stop in the phone's settings - a harder stop than a closed tab
   (`way: "browser"`). Step 5 is then run once more.
7. **Open a file to read and write:** `showOpenFilePicker` with
   `mode: "readwrite"`, the permission logged; only a check file is written
   to (any other file is left as it is).
8. **Once more as a desktop site:** an instruction only - reload with
   Chrome's Desktop site ticked. The log's opening lines then say whether
   the client hints still name Android while the user agent hides it
   (`save-target.test.ts` assumes they do; unmeasured until this runs).

The page's head line says the browser, its platform (client hints) and
whether each dialog exists; each page open also logs the user agent and
the platform line (`platformWords`), so a screenshot of the log alone
answers step 8.

## Invariants and error handling

- Every step catches its own error and logs it; a button is disabled while
  its step runs.
- The log is kept in `localStorage` (guarded: a private window keeps it for
  the page only), so it survives the reload, the closed tab and the killed
  browser.
- "Copy the log" says when it cannot copy (no `navigator.clipboard`, as on
  a page that is not secure) and when copying fails, each time pointing to
  a screenshot instead; it is never silent.
- Only check files are ever written: step 1's new file, the kept file, or
  a file step 7 recognises by its header.

## Tests

`src/checks/file-access-check.test.ts` covers the check files and the
verdicts (every cut of every file told from a whole one, a property), the
two ways of stopping a rewrite and their reading back, and the platform
line. `playwright-tests/file-access-check.spec.js` opens the page in a
browser: it loads without console errors, logs its steps and the platform
line, keeps its log across a reload, fits a phone's width, names the way a
recorded rewrite was stopped, and says so when copying is missing or
fails. What the page measures (the save dialog, kept handles, an
interrupted rewrite) needs the phone it checks.
