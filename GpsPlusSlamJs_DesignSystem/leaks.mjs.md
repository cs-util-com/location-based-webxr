# leaks.mjs — what design.css would change on an app page

- Purpose: the adoption plan's leak measurement as a tool. Before an app
  vendors `design.css`, this shows every computed-style change the sheet
  would cause on the app's page as it is - the reset's box model, the base
  layer's type - so the pins (or the decision to skip a zero-pixel step)
  rest on a measurement instead of a guess. The pilot's third leak (the
  `h1` weight) was missed by a button-only diff; this diffs every visible
  element.
- Public API (CLI): `pnpm run leaks -- <url>` with the app's dev server
  running. Prints one line per changed property
  (`tag#id.class  prop: before -> after`) and a count, or
  "no differences". Exit 2 without a URL.
- Invariants & assumptions:
  - Injects the sheet LAST via `addStyleTag`; because the app's CSS is
    unlayered it wins every conflict regardless of order, so this equals
    linking the sheet first (the plan's L1 contract).
  - Compares a fixed property list (type, colour, box model, spacing,
    radius, display) plus the element's box size, at a 390px viewport,
    before any interaction - hidden states (an opened panel) are not
    measured; shoot those through the app's e2e fakes.
  - Elements with a zero-size box are skipped (hidden sections).
- Examples: on the QR demo before M3 it listed 29 differences
  (`h1 font-size 32px -> 20px`, `p margin-top 16px -> 0px`,
  `button#start-button font-family Arial -> system-ui`), which is what
  decided against a pinned zero-pixel commit there.
- Tests: none of its own (a measurement, read by a person); the byte
  guard and the per-app gates cover what it informs.
