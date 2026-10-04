# copy-report

## Purpose

The `?qrperf` "Copy perf JSON" action, with honest async feedback (root `CLAUDE.md`, "UI feedback for async actions").

## Public API

- **`copyReport(button, json, writeText)`** - disables the button and shows `COPY_LABELS.busy`, awaits `writeText(json)`, then shows `done` or `failed`, and re-enables the button either way. A missing clipboard API (`writeText` undefined) is a failure, not a silent no-op.
- **`COPY_LABELS`** - `idle`, `busy`, `done`, `failed` ("Copy failed - screenshot instead").

## Invariants & assumptions

- The final label always reflects the real outcome; the button is never left disabled.

## Tests

`copy-report.test.ts` (in-progress label, success, refused write, no API); `playwright-tests/qrperf.spec.js` (real clipboard in Chromium).
