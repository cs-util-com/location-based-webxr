# map-browser-launcher.ts

## Purpose

Owns the **app-lifetime lifecycle** of the map-centric recording browser (Step 4C): mounts the full-bleed root container, creates the [`map-browser`](map-browser.ts.md) instance, streams the recording coverage index onto it ([`recording-index`](recording-index.ts.md)), accumulates legacy backfill candidates (Slice B1) for [`coverage-backfill`](../storage/coverage-backfill.ts.md), and tears everything down. Extracted verbatim from `main.ts` (2026-07-11), which previously held the browser/abort pair as module-level `let`s.

See the plan: `GpsPlusSlamJs_Docs/docs/2026-06-14-1048-map-centric-recording-browser-and-h3-index-user-feedback.md` (D3/D3a, Slice A/B).

## Public API

- `MapBrowserLauncherDeps` (interface) — the launcher's **only** composition-root dependency:
  - `startReplayForEntry(entry: SessionEntry): Promise<void>` — starts a single-tour replay for the tour picked on the map (D3). Injected by `main.ts` from its `replayHandlers`, because replay ownership (store swap, replay mode) must stay in the composition root. Everything else (`createMapBrowser`, `streamRecordingIndex`, `backfillCoverageIntoZips`, `showError`, `showToast`, logger) is a self-contained sibling module imported directly.
- `launchMapBrowser(folderHandle, deps): Promise<void>` — present the browser as the primary replay selector (D3a) for an opened replay folder. Wired as the folder-manager's `onReplayFolderScanned` dep. Behavior:
  - Always begins with `teardownMapBrowser()` — relaunching (new folder pick) aborts the previous stream and destroys the previous browser first.
  - Mounts the map **immediately** (empty) and streams recordings in as each is indexed (Slice A); a progress pill counts up via `setIndexingProgress`.
  - `onTotal(0)` → tears down again (never show an empty map; the modal list stays the fallback).
  - `onPlayTour` → teardown, then `deps.startReplayForEntry(recording.entry)`.
  - Accumulates `backfilled` recordings with coverage as backfill candidates; the browser's `onBackfill` CTA runs `backfillCoverageIntoZips` and reports the outcome (`showError` on permission denial, `showToast` on partial/complete success).
  - Error modes: a `createMapBrowser` mount failure (`null`) tears down and returns; a stream failure surfaces via `showError` **only when not caused by the owned `AbortController`** (an aborted stream is expected on close/folder switch).
- `teardownMapBrowser(): void` — abort the in-flight coverage stream, `destroy()` the browser, remove `#map-browser-root`. Idempotent.
- `ensureMapBrowserRoot(): HTMLElement` — create (or reuse) the full-bleed `#map-browser-root` container (`fixed inset-0 z-[80]`). Also injected by `main.ts` into `installE2eTestHooks` so the Playwright fixtures mount into the same container the real replay path uses (see [test-utils/e2e-hooks.md](../test-utils/e2e-hooks.ts.md)).

## Invariants & assumptions

- **App-lifetime, NOT AR-session-scoped.** The browser lives on the replay/setup screen; its teardown is driven entirely by its own UI paths (close button, tour pick, empty folder, relaunch). It is intentionally **not** registered in `main.ts`'s `arSessionScope`, and nothing outside this module calls `teardownMapBrowser` — identical to the pre-extraction behavior.
- **Module-level singleton state.** One `mapBrowser`/`mapBrowserAbort` pair per page, matching the single `#map-browser-root` container. `launchMapBrowser` is safe to call repeatedly (self-tears-down first).
- **A torn-down map never receives tiles.** The owned `AbortController` is passed as the stream's `signal`; `streamRecordingIndex` guarantees no emission after abort (see its sidecar).
- **Defensive:** all failure paths (mount failure, stream failure, backfill permission denial/partial failure) degrade to teardown + user-visible message rather than throwing across the folder-manager boundary (which additionally catches, so a launch error can never abort the folder-open flow).

## Examples

```ts
// main.ts wiring (the only production caller):
onReplayFolderScanned: (folderHandle) =>
  launchMapBrowser(folderHandle, {
    startReplayForEntry: (entry) => replayHandlers.startReplayForEntry(entry),
  }),
```

## Tests

- `map-browser-launcher.test.ts` — root-container create/reuse, stream-to-browser forwarding, zero-recordings teardown, `onPlayTour` handoff to `startReplayForEntry`, relaunch aborting the previous stream, non-abort vs. abort stream-failure surfacing, `null`-mount teardown, backfill candidate accumulation + success toast, teardown idempotency.
- E2E: `playwright-tests/map-browser.spec.js` exercises the real browser against fixture recordings (mounted via the `ensureMapBrowserRoot` e2e hook).
