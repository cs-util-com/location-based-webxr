# labs/globe/globe-perf-share.js - getting the recorder's export off a phone

- Purpose: globe zoom frame-hitch plan 2026-10-03-2017 §4.1, DEC-PERF-1. The
  sweep runs on a phone and its export is pasted into a chat: Copy
  (the clipboard, from the button's tap), Download (a `.json` file), and a
  selectable box as the last resort when either refuses.
- Public API:
  - `copyExport(text, { clipboard, showText })` -> `"clipboard"` or
    `"shown"`. Never throws: a refused or missing clipboard shows the text.
  - `downloadExport(text, name, { makeUrl, revokeUrl, clickLink, showText })`
    -> `"download"` or `"shown"`. Never throws. The blob URL is revoked
    10 s later (the timer is `unref`ed under Node).
  - `exportFileName(sweep, epochMs)` ->
    `globe-perf-<sweep>-<UTC time with dashes>Z.json`, safe on every
    filesystem.
  - `browserShareEnv(showText)`: the browser's parts. The clipboard is a
    getter, read when Copy is pressed (a page may gain or lose it; the
    smoke replaces it).
- Invariants & assumptions: iOS Safari allows `writeText` only inside a
  user gesture, which the Copy button's click is; the box is selected on
  show so a long-press copies it.
- Tests: `globe-perf-share.test.mjs` (each path and its fallback, the file
  name); `globe-perf.smoke.spec.mjs` (both Copy outcomes and a real
  download at phone width).
