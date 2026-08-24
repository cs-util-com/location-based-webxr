# `format-distance.ts`

## Purpose

The workspace's one distance formatter. Turns a distance in metres into the
string a user reads.

## Public API

- `formatDistance(metres, options?): string` — total; never throws.
- `DistanceFormatOptions`:
  - `metreStep` (default `1`) — round the metre value to this multiple before
    printing. `10` gives `"120 m"` rather than `"123.4 m"`.
  - `metreDecimals` (default `1`) — decimals on the metre form.
  - `kmDecimals` (default `1`) — decimals on the kilometre form.
  - `kilometreAboveM` (default `1000`) — switch to kilometres at or above this
    many metres; `null` never switches.
- Import it **deep**: `gps-plus-slam-app-framework/utils/format-distance`. It is
  deliberately not re-exported from the `/utils` barrel, for the same reason as
  `escape-html.ts` — that barrel feeds `src/index.ts`'s `export *`.

## Invariants & assumptions

- **Negative input clamps to zero, and non-finite input formats as zero.**
  Distance is a magnitude: a negative one means a caller subtracted in the wrong
  order, and `-3.0 m` on screen is less useful for noticing that than `0.0 m`. A
  `NaN` reaching the screen as the literal text `"NaN m"` is worse still,
  because it looks like a value. The three formatters this replaces disagreed
  here — one clamped, two did not, and none said so.
- **The output is unchanged for all three original call sites — for
  non-negative finite input**, which is every value any of them can actually
  receive. That much is asserted differentially rather than claimed:
  `format-distance.test.ts` re-implements each old body and compares string for
  string, with the kilometre boundary sampled from both sides.
  - **Outside that domain the output DID change**, deliberately, and an earlier
    version of this file claimed otherwise without qualification: the wayfinding
    label used to render `-3` as `"-3.0 m"`, and both the wayfinding label and
    the session summary used to render `NaN` as the literal text `"NaN m"`. The
    unification is what makes all three agree, and the new answer is the one
    that does not look like a value.
- **Options, not one output.** The three callers genuinely want different
  precision and the difference is not an accident to flatten:
  - `wayfinding-placement.ts` — `{ kilometreAboveM: null }`. A world-space AR
    label on a target the user is walking to; a target 1.5 km away is not a
    situation that HUD is for, so it stays in metres at any range.
  - `GpsPlusSlamJs_OsmDemo/src/event-label.ts` — `{ metreStep: 10,
metreDecimals: 0 }`. The distance comes from a GPS fix and an H3 cell centre
    ~4 m across, so a bare metre count would claim precision the data does not
    have.
  - `GpsPlusSlamJs_RecorderApp/src/ui/session-summary.ts` — `{ kmDecimals: 2 }`.
    A session total is compared between recordings rather than glanced at, and
    `1.23 km` distinguishes two walks that `1.2 km` does not.
- **Four options is the ceiling.** A formatter with a knob per past
  disagreement is one nobody can predict the output of. Each option here is a
  decision a real caller has made.

## Example

```ts
import { formatDistance } from 'gps-plus-slam-app-framework/utils/format-distance';

formatDistance(1234.5); // "1.2 km"
formatDistance(123, { metreStep: 10, metreDecimals: 0 }); // "120 m"
formatDistance(5000, { kilometreAboveM: null }); // "5000.0 m"
```

## Tests

`format-distance.test.ts` — three differential checks (one per original call
site, against a re-implementation of its old body), the default kilometre
boundary at exactly 1000 m, the never-switch case, step rounding, the negative
clamp and the non-finite case.
