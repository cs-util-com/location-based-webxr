# `legal.html` - the legal notice and the privacy page

## Purpose

The site's legal notice (Impressum) and privacy page (tour editor plan
2026-10-17-1816, W6, D13, D24), in English (D14). The texts are the first
drafts of
`GpsPlusSlamJs_Docs/docs/2026-10-17-2047-tour-viewer-legal-pages-design.md`
(§2, §3), built for the owner's review: the bracketed operator
placeholders stay visible until the owner fills them in, and the page says
"Draft" at its top (`data-testid="legal-draft"`).

## Structure

- ONE static page with two sections, `#notice` and `#privacy`, rather than
  two pages: every link names its section (`legal.html#privacy`), the two
  texts refer to each other, and there is one file to keep current and one
  Vite entry (`vite.config.ts`, `legal`). Deployed at `/tour/legal.html`.
- No script. `/design.css` (the verbatim shared sheet) and a small style
  block; `body.page` opts into the document ground, light when the device
  asks.

## Linked from

- the visitor's "What happens?" (`index.html`, `#visitor-privacy`);
- the setup page's footer (`index.html`, `#setup-foot`: both sections);
- the editor's open dialog fine print and its Done dialog (`edit.html`).

## Invariants & assumptions

- Nothing on the page claims more than the code does; the facts it rests
  on are listed in the design doc's §1. A change of what the app sends or
  stores changes this page in the same commit.
- `wrangler.toml` logging and the referrer policy are the owner's open
  questions (design doc §5 Q2, Q3); the page states the logging as it is.
- The operator's jurisdiction is never written into the page or the repo:
  the placeholders stay generic.

## Tests

- `playwright-tests/legal.spec.js` - the page loads with both sections,
  the Draft mark and the placeholders, and the links from the visitor's
  "What happens?", the setup footer and the editor reach it.
