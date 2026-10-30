# `lectern-check.html` - a long text on its reading stand

## Purpose

A standalone check page, linked from nothing, that draws one long text in
its `lectern` view on the production reading stand in the narrated-text
prototype's square (`public/prototypes/station-blocks-1-narrated-text/`,
opened at `index.html#mode=visitor&view=lectern`). It exists so the stand
can be compared side by side with the prototype without an AR session,
and so the layout e2e can pin where the page lands.

It is a Vite build entry (`vite.config.ts`), so it is built and reachable
on a deployed branch preview at `/tour/lectern-check.html`; nothing in the
Tour Viewer imports it. Its code is `src/checks/lectern-check.ts`
(`src/checks/lectern-check.ts.md`), which documents the hook
`window.__lecternCheck`.

## What it shows

The prototype's record (its title and first two paragraphs) on the stand,
from the visitor's eye 2.6 m away. A click on the page turns it.

## What it does not show

The camera image, the station's anchor and pose chain, the story, and the
prototype's voice (the page following the narration, the word mark, the
progress fill): the format has no narration for a long text yet.

## Tests

`playwright-tests/lectern-check.spec.js`; `src/checks/lectern-check.test.ts`.
