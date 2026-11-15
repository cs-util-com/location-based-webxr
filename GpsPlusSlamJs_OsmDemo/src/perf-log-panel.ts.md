# `perf-log-panel.ts`

## Purpose

The `?perf=1` "Copy perf log" button under OsmDemo's frame readout, and the device probe the report reads. It copies `perf-log.ts`'s report with the framework's shared `copyWithFeedback` (deep-imported from `gps-plus-slam-app-framework/utils/copy-with-feedback`, never through the `/utils` barrel), and gets the text out even where the phone refuses the clipboard.

## Public API

- `COPY_PERF_LOG_LABELS`: `idle` "Copy perf log", `busy` "Copying…", `done` "Copied", `failed` "Copy failed - text below".
- `mountPerfLogPanel(container, report, { write? })` returns `{ dispose() }`:
  - mounts the button at the pane's top-left, under the readout line;
  - on each click calls `report()` (so the copy holds the session up to that moment) and copies it; `write` defaults to `navigator.clipboard.writeText`, undefined where the page has none.
- `readPerfDevice(env)`: the `PerfDevice` from a structural environment (navigator, screen, device pixel ratio, canvas, WebGL context, `matchMedia`), so it runs in node with fakes.
- `readBrowserDevice(canvas, gl)`: `readPerfDevice` on this page.

## Invariants & assumptions

- **Async feedback** (the async-UI rule): busy and disabled while the write runs; then "Copied", which returns to the idle label after 2.5 s, or "Copy failed - text below". The button is enabled again in every case (`copyWithFeedback`).
- **The failure still gets the text out:** a read-only, focused and selected text box holding the report, and an alert line saying the clipboard refused; a warning goes to the framework logger (`[PerfLog]`). A later successful copy removes both.
- A `report()` that throws is logged and labelled "Perf log failed", the copy is not attempted, and an older fallback box is removed (its text is an older log) in favour of an alert line naming the error.
- `pointerdown`, `pointerup` and `click` stop at the panel: the 3D pane picks buildings on pointer events, and a tap on the button must not select one.
- The WebGL names: the unmasked renderer and vendor from `WEBGL_debug_renderer_info` when the browser offers it, else the masked `RENDERER` and `VENDOR`, else null; every GL call is guarded, since the extension is absent in some browsers and a lost context throws.
- Values a browser hides (`deviceMemory` outside Chromium, a zero core count) read as null. Pointer kind: `coarse`, `fine`, `none`, or `unknown` when `matchMedia` throws.
- Mounted only with `?perf=1` (`BuildingView`); without the knob nothing here exists.
- **No prototype.** A diagnostic button beside a diagnostic readout, shown only behind a debug knob, styled as that readout is: a control added to an existing panel that follows its pattern, which needs no UX prototype under the workspace's prototype rule.
- **Reuse.** No shared perf or device log exporter exists in either root: QrTrackingDemo's `?qrperf` instrument and the RecorderApp's alignment timing report are each local to their app and measure other things; the only shared behaviour here, the copy with feedback, is the framework's.

## Examples

```ts
const panel = mountPerfLogPanel(container, () => buildPerfReport(input()));
// later
panel.dispose();
```

## Tests

`perf-log-panel.test.ts` (jsdom): the success path (busy, the written text, "Copied", the idle label after the confirmation); a refused clipboard and a missing one (the failed label, the selectable box with the report, the alert line); the fallback focused and fully selected, its line with `role="alert"`; a later success clearing the fallback; a second copy restarting the confirmation; a throwing report clearing an older fallback and showing the error; pointer events kept from the pane; dispose, and its clearing the confirmation timer; the device probe with the unmasked names, the masked fallback, a throwing context, hidden values and a zero core count. The e2e in `playwright-tests/scene-3d.spec.js` covers the real button and clipboard.
