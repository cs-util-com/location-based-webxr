# `long-text-check.html` - a long text in its reading sheet

## Purpose

A standalone check page, linked from nothing, that opens one long text in
the production reading sheet over a plain background, so the sheet can be
compared side by side with the narrated-text prototype
(`public/prototypes/station-blocks-1-narrated-text/`, opened at
`index.html#mode=visitor&view=silent` after walking into the station)
without an AR session, and so the layout e2e can pin where its parts land.

It is a Vite build entry (`vite.config.ts`), so it is built and reachable
on a deployed branch preview at `/tour/long-text-check.html`; nothing in
the Tour Viewer imports it. It links the design system (`/design.css`) as
the app does, so a margin the design system zeroes shows here too. Its
code is `src/checks/long-text-check.ts` (`src/checks/long-text-check.ts.md`),
which documents the hook `window.__longTextCheck`.

## What it shows

The prototype's record (its title and first two paragraphs) in the sheet,
the reading mark on the first sentence.

## What it does not show

The camera image or the prototype's square behind the sheet, the
station's sign, the visitor's view switch, and pictures.

## Tests

`playwright-tests/long-text-check.spec.js`.
