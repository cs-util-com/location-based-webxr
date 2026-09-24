# hud-view.ts

**Purpose:** Pure formatting of the measured-size HUD readout the developer uses
to confirm a freshly printed QR against a tape measure (Note 4). No DOM.

## Public API

- `toHudView(status, size, fused?): HudView` → `{ statusLabel, sizeLabel, sampleLabel,
spreadLabel, lifecycleLabel, poseLabel }`. `poseLabel` (M3b b5) names the
  fused pose: `joint · <status> · <views> views · fit <px> px`, or
  `averaged (views disagree) · fit <px> px` for the fallback, or `—` before any
  (a non-finite fit reads `fit —`).
- `DemoStatus = 'idle' | 'scanning' | 'tracking'`.

## Invariants

- Size shown in **cm** (1 dp), spread in **mm** (rounded). A positive spread that
  rounds below 1 mm reads `<1 mm` (not `±0 mm`, which looked like false precision
  once the half-width converged sub-mm); a genuine zero spread (<2 samples) still
  reads `±0 mm`. `measuring…` while measuring with no median yet; `—` when unknown.
  Singular `1 sample`.
- `status` is the high-level lock state; `size.status` is the lifecycle stage
  (`unknown` | `measuring` | `estimated`).

## Tests

`hud-view.test.ts` — placeholders when unknown, cm/mm formatting, singular
sample, `measuring…` path.
