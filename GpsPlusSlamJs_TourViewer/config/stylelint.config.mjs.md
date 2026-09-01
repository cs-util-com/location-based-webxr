# stylelint.config.mjs

## Purpose

Stylelint configuration for the AnchorStarter. The starter ships no `.css`
files — all styling is inline in `index.html` — so this primarily validates the
`<style>` block in HTML via `postcss-html`.

## Key rules

- `stylelint-config-standard` baseline.
- `csstree/validator` (via `@carlosjeurissen/stylelint-csstree-validator`):
  catches invalid CSS properties/values (the main defence against hallucinated
  CSS).
- Formatting rules that overlap with Prettier are disabled.
- `declaration-no-important` set to `warning`.

## Invariants & assumptions

- HTML files are parsed with the `postcss-html` custom syntax.
- `lint:css` runs with `--allow-empty-input` so it never fails merely because
  no matching files exist.

## Usage

```bash
pnpm run lint:css   # stylelint "**/*.html" --config config/stylelint.config.mjs --allow-empty-input
```

## Tests

No unit test; exercised by the `lint:css` gate inside `pnpm test`.
