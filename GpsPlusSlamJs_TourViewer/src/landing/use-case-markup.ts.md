# use-case-markup.ts

## Purpose

The use-case section as one markup string: the filters, a heading and a
line on how to read the pictures, the first examples as a grid of
landscape phone screens, and the rest under "More ideas" in a native
`<details>`. Pure; `use-cases.ts` writes it into the page.

## Public API

- `renderUseCases(cases, { treatment?, shownFirst? })` - default look
  `SHIPPED_TREATMENT`, default `shownFirst` `USE_CASES_SHOWN_FIRST`.
  RangeError for an empty list, an unknown look, or a `shownFirst` that is
  not a whole number from 0 up. Every text is escaped with the framework's
  `escapeHtml` (deep import).
- `USE_CASES_SHOWN_FIRST = 6`.
- `SHIPPED_TREATMENT = "route-light"`.

## Markup

- `<section class="uc" aria-labelledby="uc-heading" data-look="<look>">`
  - a zero-size `<svg class="uc-defs" aria-hidden>` with the look's filters;
  - `<h2 class="uc-heading" id="uc-heading">What people make with it</h2>`
    and `<p class="uc-sub">`;
  - `<ul class="uc-grid">` of `<li class="uc-item" data-testid="use-case-<id>">`,
    each `<div class="uc-phone"><svg class="uc-screen" viewBox="0 0 210 100"
role="img" aria-label="<alt>">`, `<h3 class="uc-title">`,
    `<p class="uc-sentence">`;
  - when anything is folded: `<details class="uc-more">` with
    `<summary class="uc-more-toggle">` (visible text "More ideas (n)",
    "Fewer ideas" when open, one shown by CSS) and a second `uc-grid`.
- The summary comes before the list it opens, so focus moves from the
  toggle into the new examples. No script: keyboard and screen readers get
  the native disclosure, and the browser opens it for find-in-page.

## Parameters

- **Shown first, swept 6 and 8** at 390x844, 844x390 and 1440x900 (also
  with the wide test face). Six fill whole rows at the two- and
  three-column widths; eight leave a last row of two at three columns and
  add about 610 px before the fold on a 390 px phone (about 320 px at
  844x390 and 1440x900). A four-column desktop layout would favour eight.
- **The look, both built:** in true-colour a stone-coloured augmented
  object (the castle's tower) nearly vanishes into the dimmed scene; in
  route-light everything the tour adds is red, so it reads at a glance.
  Screenshots of both are with the landing build's notes.

## Tests

`use-case-markup.test.ts`: the six and the fold, the closed `<details>`,
order, the 21:10 viewBox against the CSS ratio, unique ids in either look,
determinism (also no clock or randomness in the sources), the shipped
look, the heading, no fold when all fit, bad options, escaping; properties
for any text (the tag structure never changes) and for any cut (shown plus
folded is the whole list).
