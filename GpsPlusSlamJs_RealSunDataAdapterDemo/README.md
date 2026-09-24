# Real Data Adapter demo

A standalone test tool for the production framework adapter. It shows GPS/manual
coordinates, real/fixed absolute time and the existing Sun Position Core result.
It does not integrate the Visible Sun Disc, lighting model or shadow rig.

## Run

Install workspace dependencies from the repository root with `pnpm install`, then:

```sh
pnpm --filter gps-plus-slam-real-sun-data-adapter-demo dev
```

Open **http://localhost:5192**. The dev/build commands rebuild the framework first.
Use `pnpm.cmd` instead of `pnpm` if PowerShell blocks its `.ps1` launcher.
Use the repository's supported Node version (26+) for workspace tooling.

## Controls

- **Live GPS + real time** is the default. The page requests browser location on
  startup through one framework `startGpsWatch`. Start/retry replaces that watch;
  stop clears it and its cached location. No second watcher is created by the adapter.
- **Location source** independently selects live or fixed coordinates. Editing
  latitude/longitude selects fixed mode immediately. Initial manual values are
  Berlin, not a fabricated GPS fix.
- **Time source** independently selects real time or a fixed instant. Real time
  refreshes every 30 seconds, on tab resume, or with Refresh now. Fixed time does
  not advance. This is the device wall clock, not a network/GNSS time service.
- **Absolute time** accepts ISO 8601 with `Z` or an explicit `±HH:MM` offset.
  Missing offsets, impossible dates and invalid clock values are rejected. No
  local-time conversion or manual timezone-offset arithmetic is used.
- **UTC day + slider** covers 00:00–23:59 in one-minute steps. Moving it selects
  fixed time while preserving location mode. Slider edits set seconds/milliseconds
  to zero; typed ISO input can preserve them.
- **Apply fixed location + fixed time** atomically loads Berlin and
  `2026-06-21T12:00:00Z`. Repeating it produces the same sample. This is a synthetic
  replay-oriented example, not a recording loader.
- The summary shows effective sources/coordinates/UTC instant and location fix
  time. Results show radians/degrees, horizon status, NUE direction and expandable
  exact adapter state. Azimuth 0 is South, positive toward West (core convention).

Incomplete manual edits temporarily show invalid state rather than retaining a
misleading previous result. Select real time, correct the input, or use the fixed
pair to recover. GPS remains cached in the background while manual coordinates
are selected. On GPS errors this host clears the live cache so stale coordinates
are not presented as a current fix. Fixed mode continues working.

GPS requires browser support/permission and a secure context (HTTPS or localhost).
Plain HTTP on a phone's LAN address is usually insufficient. GPS-denied/unsupported
desktop users can select fixed location or the repeatable example immediately.
The page releases its watch, subscription and timer on exit/HMR; back/forward-cache
restoration reloads the page with defaults.

## Validation

```sh
pnpm --filter gps-plus-slam-real-sun-data-adapter-demo test
pnpm --filter gps-plus-slam-real-sun-data-adapter-demo typecheck
pnpm --filter gps-plus-slam-real-sun-data-adapter-demo build
pnpm --filter gps-plus-slam-real-sun-data-adapter-demo test:e2e
```

Browser tests need an installed Playwright Chromium browser. To use installed Edge
in PowerShell, set `$env:PLAYWRIGHT_CHANNEL = 'msedge'` before `test:e2e`.
The test runner starts its own server on 5192 and refuses to reuse a running one.
Builds, browser screenshots/traces and test reports are ignored by git.

Pure tests cover absolute-time parsing, calendar validity, equivalent offsets,
daylight-saving ambiguity and UTC slider bounds. Browser tests exercise all four
modes, background GPS updates, UTC edits, repeatable pairs, invalid input recovery,
permission denial/unavailability, timers, cleanup and a narrow viewport.

Manual checklist (real or browser-emulated GPS):

| Location | Time  | Expected behavior                                           |
| -------- | ----- | ----------------------------------------------------------- |
| Live     | Real  | A received GPS fix plus current time; refresh advances time |
| Fixed    | Real  | Editable coordinates; GPS updates do not replace them       |
| Live     | Fixed | New GPS positions use the same selected absolute time       |
| Fixed    | Fixed | Repeated input pairs yield identical output without GPS     |

Also test denying GPS, invalid latitude and a date without an offset; the fixed
example must always provide a recovery path. Test slider midnight/noon and switch
back to real time; only the time source should change.

Automated GPS is **emulated at the browser boundary**, passing through the real
framework GPS mapper and production adapter. It does not establish physical GPS
accuracy or agreement with the observed outdoor sun. Real outdoor GPS/sun checks,
Task 1 recording e2e validation and final system integration remain later work.

### Validation record (2026-09-16)

- 29 pure unit tests passed; demo typecheck and production build passed.
- All 9 browser scenarios passed in headless Edge with emulated GPS, including
  all four input combinations, timer behavior, cleanup and mobile layout.
  Desktop and mobile screenshots were also visually inspected.
- Tooling ran on the available Node 22.19.0, which emits the workspace's Node 26+
  engine warning; repeat on the supported runtime before release.
- The repository-wide port guard found an existing collision on 5189 between
  VisibleSunDiscDemo and SunShadowRigDemo. This demo uses the unique port 5192;
  the older demo configurations were left unchanged.
