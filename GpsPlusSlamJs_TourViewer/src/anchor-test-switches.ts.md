# `anchor-test-switches.ts`

## Purpose

The deferred anchors' field-test switches for the Tour Viewer, read from
the page address only on a page with `?debug=1`, in every build. The phone
test of the deferred anchors can then run from a deployed preview, with
no development server and no PC.

The framework's own readers (`devWorldJumpFromPage`,
`anchorDeferralFromPage` in `gps-plus-slam-app-framework/ar/ar-parent-target`)
read the address in development builds only, and a production build drops
them (`ar-parent-target.build.test.ts`). The Tour Viewer passes its own
values to `enableArWorldGroupAlignment` instead (`seams.ts`), so those
readers never apply here, in the development server either.

## Public API

- `AnchorTestSwitches { devJump: DevWorldJump | null; deferAnchors: AnchorDeferral }`:
  what `enableArWorldGroupAlignment` takes in place of the page readers.
- `ANCHOR_SWITCHES_OFF`: `{ devJump: null, deferAnchors: true }`, a
  visitor's page.
- `anchorTestSwitchesFromSearch(search): AnchorTestSwitches`
  - With `debug=1` (or `debug=true`, the framework's
    `debugUiEnabledFromSearch`):
    - `devWorldJumpM=<m>` and/or `devWorldJumpDeg=<deg>`: a synthetic
      world jump every 10 s (`parseDevWorldJump`), else none;
    - `anchors=0`: the deferral off for the session; `anchors=ab`: on and
      off in turns of 15 s (`ANCHOR_DEFERRAL_AB_PERIOD_S`), so one session
      measures the frame time both ways; anything else: on.
  - Without it, or for a value that is not a string:
    `ANCHOR_SWITCHES_OFF`, whatever else the address says.

## Invariants

- Never active without `?debug=1`. Why that is safe in production: both
  switches only change how this one page places content in its own
  session; nothing is stored, sent or written to a recording, and
  `?debug=1` is already the page's diagnostic mode (its readout and Copy
  log). A link someone shares with the switches affects only who opens it.
- The jump moves anchored content on purpose and the deferral off lets
  corrections land in view: a visitor never gets either from a normal link.

## Example

```ts
enableArWorldGroupAlignment({
  store,
  arWorldGroup,
  ...anchorTestSwitchesFromSearch(location.search),
});
```

## Tests

- `anchor-test-switches.test.ts`: the values with `debug=1` and
  `debug=true`; off without it (`debug=0`, `debug=yes`, none, no string).
- `anchor-test-switches.property.test.ts`: any address without a debug
  flag gives `ANCHOR_SWITCHES_OFF`.
- The framework's `ar-world-group-alignment.test.ts`: options passed in win
  over its development-only page readers.
