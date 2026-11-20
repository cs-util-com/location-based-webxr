# `splat/index.html` - make a splat from a recording

## Purpose

The splat trainer page: a desktop page that will turn a recording from
the recorder app into a splat, on this computer, nothing uploaded. Until
the GPU trainer exists it reads a recording, shows how it would be made,
and says the splat maker is not ready yet; `?trainer=practice` runs the
whole flow with a scripted practice trainer.

It is a Vite build entry (`vite.config.ts`), so it is built and reachable
on a deployed branch preview at `/tour/splat/`; nothing links to it yet.
The page logic lives in `src/splat-trainer/` (`splat-main.ts`,
`trainer-page.ts`).

## Head

- `referrer: no-referrer`, `robots: noindex`, `color-scheme: light dark`,
  an empty icon (no favicon request), title "Make a splat".

## Tests

`playwright-tests/splat-trainer.spec.js`.
