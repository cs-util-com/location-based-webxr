# `scripts/shoot-chapters.mjs` — manual visual-review screenshot helper

## Purpose

One-shot dev tool (round-4 verification approach): boots the landing's
vite dev server on an ephemeral port, drives a headless Chromium through
the 3D scroll story and captures screenshots at chapter framings or at
EXACT story-timeline positions, per palette. Exists because several
round-4 findings (doubled rings, dive sequencing, dark-palette contrast)
are only catchable by looking at pictures — while golden-image CI
assertions were consciously rejected (headless-GPU rendering differs per
machine ⇒ flaky).

## Public API (CLI)

`pnpm run shoot -- [flags] [targets...]` from `GpsPlusSlamJs_Landing/`:

- Targets: chapter ids (`hero qr fusion dive anywhere gallery cta`,
  default: all) — scrolled to the section center; or `ms:<n>` — an exact
  story-timeline millisecond (0..7000), converted to a scrollTop via the
  inverse of `scroll-story.ts`'s center-line mapping.
- `--palettes=dark,light,...` (default `dark`) — seeds
  `localStorage["gps-landing-theme"]` before load.
- `--mobile` — 412×915 viewport instead of 1280×800; `--landscape` —
  915×412 (wins over `--mobile`).
- Output: `test-results/shots/<target>-<palette>[-mobile].png`
  (gitignored); paths are printed.

## Invariants & assumptions

- `STORY_DURATION_MS` (7000) must equal
  `CHAPTER_COUNT × CHAPTER_DURATION_MS` from `src/scene/story-timeline.ts`
  — update together if chapters are added.
- Waits `SETTLE_MS` (1400 ms) after each scroll: the scrub smoothing
  (τ = 240 ms, `scene-controller.ts`) has fully converged by then.
- A dev SCRIPT, not a test: fixed waits are acceptable here; the
  Playwright-test `waitForTimeout` ban applies to specs only.
- Failure mode: throws (non-zero exit) if the dev server yields no URL or
  Chromium cannot launch; nothing is written in that case.

## Examples

```bash
pnpm run shoot -- --palettes=dark,light fusion   # V1 ring review
pnpm run shoot -- ms:3050 ms:3550 ms:3860        # V2 dive sequence review
pnpm run shoot -- --mobile hero cta              # phone framing
```

## Tests

None (dev-only tool, exempt from the unit-test mandate); its correctness
is self-evident from its output — the screenshots it exists to produce.
