# Tour Viewer - lessons learned

Known pitfalls of this package, curated (not a log). Check before a task,
add after a surprise.

## A reduced-motion rule must name the animated rule's own selector

- The walk's `@media (prefers-reduced-motion: reduce)` block once said
  `.walk-coach-spin` and `.walk-toast` with shorter selectors than the
  rules that started their animations
  (`.walk-coach[data-look="spinner"] .walk-coach-spin`, and the toast's
  own). The longer selector won on specificity, so the coach's spinner and
  the toast kept moving for a visitor who asked for less motion, while
  the block read as correct.
- Rule: in the reduced-motion block, repeat each animated rule's selector
  exactly. `walk-sheet.test.ts` cuts the walk's CSS into its blocks and
  holds every selector that sets an `animation` to one the block stills.
- No e2e saw it: headless Chromium emulates the media query, but no test
  asked whether an element that animates stopped.

## The e2e dev server serves the source as it is at request time

- The Playwright web server transforms `src/` on request, so a spec run
  while files are being edited tests the half-edited source, and a red
  run meant to show a test failing before its fix must run before the fix
  is written. Keep the fix unwritten until the red run has executed, and
  do not edit `src/` while a run you will read is in flight.

## Shell one-liners lose backslashes here

- In this workspace's shell, `node -e '...'` scripts and heredocs feeding
  them can drop backslashes: `\d` arrives as `d` and `\b` as a backspace
  character. A regex written that way still parses, and a test built on
  it can pass while checking nothing.
- Rule: write anything with a backslash by the editor tools, or in a
  script file that uses `String.raw`. After a scripted edit, search the
  diff for backspace characters and for regexes that lost their escapes.

## The two walk HUDs and the e2e fakes

- The walk runs two wayfinding HUDs (`walk-hud.ts`). The e2e fake keeps
  every start in `test.huds`, the last pair in `test.hudPair`, and
  `test.hud` as the pair read as one HUD. A spec that asserts on
  `test.hud.getTargets()` sees the focus's target first.

## A frame-count poll needs its own ceiling

- The 3D view draws every frame, but software-drawn at a desktop size it
  manages only 4 to 8 frames a second (about 7 locally, about 5 on the CI
  runner). A check that waited for 30 more frames under a poll's 5 s
  default passed locally by a few hundred milliseconds and failed on the
  CI runner on every try, the count still climbing when the poll gave up.
  It read as "the view stops drawing"; it never did.
- Rule: wait for frames with `afterFrames` in
  `playwright-tests/editor3d-fixture.js`, whose ceiling is far above any
  plausible frame rate. To reproduce a slow runner locally, slow the page
  with the CDP `Emulation.setCPUThrottlingRate` (6x brought it to about
  4.5 frames a second).

## A scripted replace treats `$` in the new text as a pattern

- `s.replace(oldText, newText)` with a string `newText` still expands
  `$&`, `` $` `` and `$'` in it: a script that inserted a regex-escaping
  helper (`"\\$&"`) and a regex ending in `` $` `` pasted the file's own
  text into itself.
- Rule: in an edit script, replace with `s.split(oldText).join(newText)`,
  which inserts the text as written; check `git diff --stat` for a file
  that grew far more than the edit.

## A unit timeout under a loaded machine is not a red test

- With the machine near full CPU from other sessions, vitest's 5 s
  default timed out property tests and hook-heavy repo-config tests that
  pass in well under a second alone. Each such red was attributed by
  running the named files alone with `--testTimeout=120000`; a timeout
  that also fails there is a real red.

## Two colour eases of one length do not arrive in the same frame

- A test polled until the download pill had its ink, then read Next as
  the "before" colour. Both pills ease their background over the same
  250 ms, but the download moved little or not at all while Next crossed
  from ink to white, so in about a quarter of local runs Next was still
  easing (226 to 254) when the poll ended, and the later settled read
  (255) no longer matched. A full CI run caught it as 254 against 255.
- Rule: a colour read after a state change waits until the element's
  `getAnimations()` are finished, for every element it reads; never
  loosen the expected colour.

## A float sized from the window covers what must fit beside it

- The map sticker's chosen size has a 184 px floor; on a 320 px phone
  that left 86 px beside it for a station row of six 22 px dots (142 px),
  and a flex row cannot shrink below its content, so the last two dots ran
  under the sticker and its zoom button took their taps. The card layout
  test never ran below 390 px.
- Rule: a float's width is capped by the room its neighbours need
  (`min(size, 100% - room)`), and the layout test runs at the narrowest
  phone the page supports.
