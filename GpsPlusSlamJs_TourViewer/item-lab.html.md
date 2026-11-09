# `item-lab.html` - try a new kind of item in both contexts

## Purpose

A standalone check page, linked from nothing, where a session tries a new kind of item in a story and directly in a station, without touching the app or another session's kind. It is a Vite build entry (`vite.config.ts`), so it is reachable on a deployed branch preview at `/tour/item-lab.html`. `?kind=<folder>` names a folder of `public/prototypes/item-kinds/` (`stamp-1` by default); that folder's `README.md` says how to add one.

## The page

- Left, in a story: the kind and a plain card as a two-step story, in the real scene view, with stand-ins for the stage and the sound.
- Right, in a station: a small three.js scene with the real free host, and the kind's world view beside the figure when it has one. A tap on the item does what the real host does. Under it, the cost line (`#lab-cost`) and what the kind's `read` fixed in the record shown (`#lab-problems`).
- Below: start again, stop, a tap in each context, a second sound, the end of the sound, a walk away, held files, one control per record, play or edit, a tap in the world, ten rounds, the dark backdrop, and one control per file to lose it.
- At the bottom: the page's state, as the e2e reads it through `window.__itemLab`.

Design: `src/checks/item-lab.ts.md`, which also lists what the free host lacks.

## Invariants

The CSS is inline and uses `/design.css` for the buttons. The page has no sideways scroll at phone width.

## Tests

`playwright-tests/item-lab.spec.js`.
