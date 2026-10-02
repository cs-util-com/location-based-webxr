# qr-anchor-summary.ts

## Purpose

One-line: turn the per-code anchor outcomes into the lines the session summary
screen shows after a recording.

In the zip, a code that was **declined** and a code that was **never seen**
look identical: no file. So the refusal has to be said out loud on the screen
the author actually reads after a walk — otherwise the only feedback for "your
poster moved" is silence, and the author uploads a zip that cannot relocalize
anything.

## Public API

- `qrAnchorSummaryLines(outcomes): string | null` — one line per code, or
  `null` when none were seen (the block is hidden rather than shown empty).

## Invariants & assumptions

- **Plain language, and numbers an author can act on**: how many visits, how
  far the code turned between them, and the size to check against a tape
  measure.
- **A foreign code is named as foreign**, not by an empty id.
- **The recency weighting is mentioned only when it MOVED the answer** (more
  than half a metre). The half-life is a guess until the field probe measures
  it, and saying when it changed something is what makes that guess checkable
  on the phone instead of on trust.
- **Never prints `undefined` or `NaN`** for a partially-filled outcome — a
  declined code carries no size or spread.
- **An uncertain heading is said out loud** (owner decision D31): a written
  code whose outcome carries `headingUncertain: true` (its alignment rested
  on under 10 m of GPS extent) gets "Heading uncertain: walk a bit further
  before saving for a reliable direction." after its line. Absent (an older
  mint, or one that could not tell) and `false` add nothing, and a refused
  code never gets it: no file was written, so there is no heading to doubt.
- The metres-per-degree constant is only ever used to decide whether a
  difference is worth a sentence; it is not a geodesy result and must not be
  reused as one.

## Tests

`qr-anchor-summary.test.ts` — the hidden-when-empty case; a placed code with
its visit count, size and turn; a refusal said out loud with its reason; the
foreign-code label; the weighting note appearing only when the answer actually
moved; singular "1 visit"; the uncertain-heading note shown only for a written
code marked `headingUncertain: true`; and no `undefined`/`NaN` for a partial outcome.
