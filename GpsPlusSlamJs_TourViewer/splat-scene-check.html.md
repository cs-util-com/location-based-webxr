# splat-scene-check.html

## Purpose

A standalone test-support page for the splat trainer: it renders a walk through a synthetic textured scene at known camera poses, zips it as a recorder-shaped recording, and reads the zip back with the splat trainer's reader. It is a build entry linked from nothing (served at `/tour/splat-scene-check.html` on the site), not product UX.

## What it does

- Options: the walk (straight, or a loop round the object), the number of photos (default 24) and the photo size (320 x 240, 640 x 480 or 960 x 720).
- "Build the walk" renders every photo with WebGL, measures each photo's depth from the scene itself, writes the zip and reads it back. The status line says how far it got ("Rendering 3 of 24 photos..."), then what the reader found (frames, photo size, path length, depth samples), or the reader's refusal, or why building failed.
- The walk's first photo is shown, and "Save the zip" offers the zip to train on.
- The page holds no user data, sends nothing and loads nothing from another host.

## Behaviour

- One action at a time: the build button is disabled while a build lasts and enabled again whatever its outcome.
- The page's state is one attribute, `#state[data-state]` (`idle`, `building`, `read`, `refused`, `error`); the e2e waits on it.
- One column at any width; the photo shrinks to the page.

## Code

- `src/checks/splat-scene/splat-scene-check.ts` wires the page; the scene, rendering and zip are in the modules next to it, each with its own sidecar.

## Tests

- `playwright-tests/splat-scene-check.spec.js`: a straight and a loop walk of 6 photos are built in the page under a software renderer; the reader accepts each whole, and the first photo decodes at the size asked for and is not a flat colour.
- `src/checks/splat-scene/splat-scene-check.test.ts`: the page's success, failure and bad-input paths in jsdom, with the rendering replaced.
