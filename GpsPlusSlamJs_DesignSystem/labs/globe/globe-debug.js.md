# globe-debug.js

- Purpose: the globe lab's Debug panel (round-6 plan 2026-10-04-1050 G6-0,
  DEC-G6-6). A small button, always there, at the left edge at
  mid-height: on a phone the controls are top right, and the readout, pin
  and frame-hitch recorder sit along the bottom.
- Opened, it shows (4 times a second) the altitude, the distance to the
  target, latitude and longitude under the camera, heading and pitch, E,
  the band share, each carrier's tiles and cache, the relief's kept
  heights (count and MiB), and the event count.
  - **Record** starts a recording of frame times and events while the owner
    zooms by hand: touches do not void it, unlike `#perf=1`'s scripted
    runs. **Stop** ends it and shows the framework's summary.
  - **Copy** puts the device block (`globe-device.js`), the live state, the
    recording and the event log (`globe-debug-log.js`) on the clipboard as
    one JSON. **Download** saves it. When either is refused, the text is
    shown to select.
- Public API: `createGlobeDebug({ log, live, device })` -> the frame hooks
  the lab fans out to (`frameStart`, `frameEnd`, `mark`) and `api` for the
  smokes (`exportText()`, `recording()`, `lastExport()`). `live()` returns
  plain numbers and strings, and `device()` the device block. The export's
  `link` is the page's URL with `view=` set to the live pose
  (`formatViewText`; volume-cloud plan §16), so an export pasted back opens
  exactly that view; null without a readable pose.
- Invariants: the frame statistics are the framework's (`createFrameRun`
  and `formatFrameRunSummary` through `globe-perf-stats.js`, DEC-H3). The
  recorder core and the share helpers are the frame-hitch recorder's
  (`globe-perf-recorder.js`, `globe-perf-share.js`). They load (a dynamic
  import) when the panel first opens, so a page whose panel stays closed
  never fetches them and `#perf=1` stays the only thing that loads the
  recorder at boot (`globe-perf.smoke.spec.mjs`, which failed from round 6
  until this was fixed). Each button awaits that load; closed, the panel
  does no per-frame work at all.
- Tests: the fast tier's globe test (`3d/pages.fast.spec.mjs`) opens the
  panel, records 10 frames, presses Copy, and parses the export: format,
  a finite altitude, frames recorded and events present.
