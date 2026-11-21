# `travelling-box-check.html` - a narrated text's words under its sign

## Purpose

A standalone check page, linked from nothing, that shows one narrated
long text's reading sign with its words painted on a plate under it, as
the travelling box prototype
(`public/prototypes/sign-speaks-r6-2-travelling-box/`) draws it, without
an AR session. It exists so the build can be compared side by side with
the prototype and so the layout e2e can pin the plate.

It is a Vite build entry (`vite.config.ts`), so it is built and reachable
on a deployed branch preview at `/tour/travelling-box-check.html`; nothing
in the Tour Viewer imports it. Its code is
`src/checks/travelling-box-check.ts` (`src/checks/travelling-box-check.ts.md`),
which documents the hook `window.__travellingBoxCheck`.

## What it shows

The prototype's weighing house text on the app's reading sign, its words
on the plate under it, from the visitor's eye 3 m away. The voice stands
still until the hook moves it.

## What it does not show

The camera image, the station and its pose chain, and a real voice (the
hook moves a clocked one). The taps, drags, the flight to the bottom of
the screen and back, and the hiding are shown and tested here. The app's
own travel wiring (the follow, the registry, the camera) is a phone test:
no AR spec travels the words (headless has no camera to project through;
the AR specs cover the words at the bottom only).

## Tests

`playwright-tests/travelling-box-check.spec.js`.
