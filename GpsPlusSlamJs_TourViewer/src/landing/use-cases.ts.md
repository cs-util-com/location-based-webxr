# use-cases.ts (and use-cases.css)

## Purpose

`mountUseCases(host)`: puts the landing page's use-case section into its
mount point. The only module of the section that touches the DOM, and the
one that imports `use-cases.css`, so Vite bundles the styles into the
section's dynamic chunk.

## Public API

- `keepUsesHeight`: re-exported from `uses-height.ts`, so the height
  keeper ships in this chunk and loads (or fails) with the section it
  keeps.

- `mountUseCases(host: HTMLElement): { destroy(): void }`
  - replaces the host's content (the page's placeholder) with
    `renderUseCases(USE_CASES)` in the shipped look;
  - `destroy()` empties the host (`replaceChildren()`); a second call does
    nothing;
  - TypeError without a host.

## The stylesheet

- Every selector starts with `.uc`.
- It reads these page variables, each with a fallback: `--ink`,
  `--ink-dim`, `--map-route`, `--map-serif`, `--space-2`, `--space-4`,
  `--tap`.
- The design sheet zeroes every margin, so every gap is set here: heading
  8 px, sub line 22 px, grid gaps 26 px by 22 px, title 12 px above and
  5 px below, the fold 28 px above, the folded grid 26 px below the toggle.
- One column, two from 640 px wide, three from 1040 px; the screen keeps
  `aspect-ratio: 21 / 10`. A phone held sideways (landscape, at most
  560 px high) gets smaller headings.
- The summary is drawn as a pill button at least `--tap` high, with a
  focus ring in the route colour. No `clamp()`, `color-mix()` or `dvh`
  (the stylelint validator rejects them).
- Nothing in the section moves, so it needs no reduced-motion rule.

## Invariants & assumptions

- The markup is built from this package's own data, every text escaped,
  so writing it with `innerHTML` is safe.
- Mounted once per page: the section's ids (`uc-heading`, the filters) are
  unique only per mount.

## Tests

`use-cases.test.ts` with a two-member fake host (node, no DOM): mounting
replaces the placeholder, destroy empties once, a missing host throws.
The keyboard behaviour of "More ideas" is for the page's e2e.
