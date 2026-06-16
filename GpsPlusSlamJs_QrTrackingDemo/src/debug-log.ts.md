# debug-log.ts

**Purpose:** A bounded line buffer + formatters for the demo's on-screen debug
log. Surfaces a **per-frame diagnostics** line — the on-device root-cause readout
for the "0 samples / nothing glued" investigation — plus the **Δt between
frames**, so depth coverage, raw size/quality, the accept/reject reason, and the
detection cadence are all visible on a real device.

## Public API

- `createDebugLog(maxLines = 40): DebugLog` — `{ append(line), lines }`, a ring
  buffer (oldest dropped past the cap; can't leak).
- `formatDiagnosticsLine({ clockMs, deltaMs, text, depthCornerHits, sizeM, quality, sampleCount, status, reason })`
  → e.g. `"[12.34s Δ132ms] \"…\" d4/4 20.1cm q0.62 (0) measuring — low quality 0.62 — no sample yet"`.
  `deltaMs: null` → `Δ—`; `depthCornerHits: null` → `d—`; `sizeM: null` → `?`;
  `quality: null` → `q?`; long payloads truncated. Reading it: `d<4` ⇒ depth
  missing at corners; `q` below the accept threshold with `(0)` ⇒ the quality gate
  is rejecting every sample; a wildly-wrong `sizeM` at `d4/4` ⇒ coarse/stale depth.
- `formatStatusLine(clockMs, status)` → `"[5.00s] → tracking"`.

## Invariants

- Pure + bounded + DOM-free → unit-testable; `main.ts` renders `lines` into a
  `<pre>`, appends one line per `onFrameDiagnostics` (only when `detected`, to skip
  "no QR" spam), and computes `deltaMs` from the previous logged frame's clock.

## Tests

`debug-log.test.ts` — ring-buffer bound/order; diagnostics-line formatting
(clock/Δt/depth/size/quality/count/stage/reason, first-frame `—`, unknown
`d—`/`q?`/`?`, truncation); status line.
