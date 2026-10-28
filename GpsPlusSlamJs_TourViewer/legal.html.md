# `legal.html` - forwards to the site-wide legal page

## Purpose

The legal notice and the privacy page used to live here, for the Tour
Viewer alone. They are now one page for the whole site, at `/legal/`
(source: `GpsPlusSlamJs_Landing/legal/index.html`, with its own sidecar),
because every app on the site needs the same notice and the privacy text
has to cover every app's data flows. This file stays as a forwarder so that
a saved or shared link to `/tour/legal.html#privacy` still arrives at the
right section.

## Why a forwarder and not a deletion

The page reached the deployed site before the move, so links to it may
exist outside the code. Deleting it would turn those into a 404 from the
site worker; a forwarder costs one small file.

## Behaviour

- An inline script calls `location.replace("/legal/" + location.hash)`, so
  `#notice` and `#privacy` are kept and the forwarder leaves no entry in the
  history.
- Without script, `<meta http-equiv="refresh">` goes to `/legal/` (the
  section is lost, the page is still found), and the body carries a plain
  link.
- Still a Vite entry (`vite.config.ts`, `legal`), so it is built and
  deployed at `/tour/legal.html`.
- `/legal/` is root-absolute on purpose: the page is not part of the Tour
  Viewer's base. `scripts/build-site.mjs` exempts exactly the site-wide
  pages from its bare-absolute-URL guard.

## Linked from

Nothing in the app links here any more: the visitor's "What happens?", the
setup page's footer (`#setup-foot`) and the editor link `/legal/` directly.
The facts the Tour Viewer's part of the privacy text rests on are listed in
the legal pages design doc (section 1) and in the earlier history of this file; a
change of what the app sends or stores changes `/legal/` in the same
commit.

## Tests

- `playwright-tests/legal.spec.js` - the forwarder lands on `/legal/` with
  the section kept; the app's links point at `/legal/`. On the dev server
  `/legal/` is not this app's page, so the spec checks the address, not the
  text; the text is tested where it lives (`GpsPlusSlamJs_Landing`,
  `playwright-tests/legal.spec.js`).
