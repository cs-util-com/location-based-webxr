# `narration-look-check.html` - a narration circle in its look

## Purpose

A standalone check page, linked from nothing, that draws one narration
circle in the production look (`src/kinds/audio/narration-look.ts`) on the
narration prototype's bright square
(`public/prototypes/audio-narration-spot-1/`, look "Plume", eye view). It
exists so the look can be compared side by side with the prototype without
an AR session, and so its frame cost can be measured in a browser.

It is a Vite build entry (`vite.config.ts`), so it is built and reachable
on a deployed branch preview at `/tour/narration-look-check.html`; nothing
in the Tour Viewer imports it. Its code is `src/checks/narration-look-check.ts`
(`src/checks/narration-look-check.ts.md`), which documents the hook
`window.__narrationLookCheck`.

## What it shows

"The old well", a 6 m circle at the square's centre, from the visitor's eye
20 m south, idle and outside.

## What it does not show

The camera image, the station's anchor and pose chain, the player card, and
the voice: the state is set through the hook.

## Tests

None of its own: it is the place where the look is looked at.
