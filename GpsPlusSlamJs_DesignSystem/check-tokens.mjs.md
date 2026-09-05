# check-tokens.mjs — the token-contract checks, as a gate stage

- Purpose: fail the package gate when the design system's source drifts
  from its own token contract. Two checks, one implementation, two entry
  points: `pnpm run check:tokens` (a stage of `pnpm test`) and a
  side-effect `import` at the top of `shoot.mjs`, so screenshots still
  fail fast on the same problems. They used to live inside `shoot.mjs`
  alone, which made them run only when a human asked for screenshots -
  i.e. never in a gate (adoption-plan review, 2026-08-27).
- Public API: none - it is a script, nothing imports a symbol from it
  (knip would flag an unused export, and did). It reads
  `design.css` + `catalog.css` + `hud-design-brief.md` and exits 1 on
  any problem.
- Invariants & assumptions:
  - **Check 1 - no colour literal outside the tokens layer.** The
    `base`, `atoms` and `screen` layers must speak in `var(--token)`; a
    hex, `rgb()`, `hsl()` or `oklch()` there is a value the contract
    does not know. Comments are stripped first. `mask` lines are exempt
    (a `#000` in a mask is an alpha stencil, not a colour). `reset` and
    `demo` are exempt - the camera stand-ins are hex by nature.
  - **Check 2 - every `--token` the brief names is DEFINED in the CSS**
    (`--name:`), never merely referenced: a `var(--name)` surviving a
    deleted declaration is the drift this check exists for (PR #411
    review). `--token` (the brief's generic placeholder) and
    `--orange-500` (its forbidden example) are whitelisted as prose.
  - Both checks read BOTH sheets concatenated: after the split, a check
    reading one file would pass vacuously (no tokened layers) or
    false-positive on every token.
  - Layer bodies are found by brace counting from `@layer name {`, so a
    nested `@layer` inside a block would be miscounted - there are none,
    and the split script asserts the top-level order.
- Examples: `pnpm run check:tokens` → silent, exit 0. Plant
  `outline-color: #ff0000` in `.plate` → `color literal in @layer atoms:
outline-color: #ff0000;`, exit 1. Append `` `--phantom-token` `` to the
  brief → `brief mentions --phantom-token, the CSS does not define it`,
  exit 1.
- Tests: no unit test file - the checks are negative-tested by hand on
  every round that touches them (both directions verified 2026-09-02,
  M1 of the adoption plan). A package whose gate is seconds-cheap on
  purpose does not carry a vitest install for two regexes; if a third
  check arrives, that is the moment to add one.
