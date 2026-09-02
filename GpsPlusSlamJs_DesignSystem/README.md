# GpsPlusSlamJs_DesignSystem

The HUD design system for the AR apps in this workspace, kept as vanilla
HTML + CSS so it can be iterated at conversation speed: open
`index.html` in a browser, react, edit, refresh. No build, no
framework, no dependencies at runtime.

Two stylesheets, split on purpose (adoption plan M1, 2026-09-02):

- **`design.css`** - the design system: `@layer reset, tokens, base,
atoms, screen`. This is what an app vendors, verbatim. It styles no
  page ground and never uppercases `body` - the voice is applied at the
  atom boundary, so a host page's own prose is untouched. A bare page
  that loads only this file gets the type, the colour, the atoms and
  the composed HUD layouts.
- **`catalog.css`** - the catalog's own chrome: page layout, the phone
  frame, the camera stand-ins, the switcher, and the fake-phone
  placement of annotations/radar/toast. **Never vendor this.**

What the file contains:

- **A token layer** (CSS custom properties): translucent dark slate
  surfaces, one orange accent, raised neumorphic dual shadows, a rounded
  system font stack, spacing/shape/motion tokens.
- **An atoms column**: plate, button (incl. rounded-square icon buttons),
  toggle, slider, switch, select, progress-with-tones, readout lines,
  toast, world annotations (diamond marker, leader-line callout), radar.
- **Mock screens** inside one phone frame, switchable: the OsmDemo AR HUD
  steady state, its experiments panel, and the AnchorStarter placement
  flow — all using **real strings from the shipped apps**, not lorem.
- **Camera stand-in backgrounds** (foliage, white wall, blown sky, night
  street — all textured, plus a live `getUserMedia` mode), because the
  design's central problem is legibility over an arbitrary camera feed.
  Background and screen selection persist in the URL hash.

`hud-design-brief.md` is the companion **paste-anywhere prompt**: give
it to any LLM chat to generate independent HUD mockup variants of the
same screens, then feed the keepers back into this file.

## Iterating

Edit `design.css` (or `index.html`), refresh the browser. One
change-set per reaction. The gate (`pnpm test`) is seconds-cheap on
purpose - this is a taste instrument - but since `design.css` became
the sheet the apps vendor it is no longer prettier-only: stylelint over
both sheets (`config/stylelint.config.mjs`, with the language's own
conventions - decimal alphas, BEM modifiers - written in as reasons),
and `check-tokens.mjs`, which fails on a colour literal outside the
tokens layer or a token the brief names that the CSS lost. Design decisions and their history live
in the private docs repo (`GpsPlusSlamJs_Docs/docs/`, the design-system
extension plan).

## Seeing what you shipped

```bash
pnpm run shoot                      # the phone, every screen, foliage
pnpm run shoot -- --bg=sky          # ...over the blown-sky background
pnpm run shoot -- --screen=hud      # one screen only
pnpm run shoot -- --sel=".radar"    # 3x close-up of one element
pnpm run shoot -- --page            # whole page including the atoms
```

Headless Chromium screenshots land in `shots/` (gitignored), for humans
in a hurry and for agents that would otherwise edit CSS blind. It is an
eyeball tool, not a gate: golden-image assertions are deliberately
rejected because headless-GPU output differs per machine. One exception:
console/page errors fail the run - including the page's own atom-drift
assertion, which checks that the atoms column and the screens still
show identical markup for the duplicated atoms (radar, annotations).

## Phone rounds

```bash
pnpm run serve   # then open the printed http://<lan-ip>:4173/ on the phone
```

Plain HTTP on the LAN: refresh-speed iteration on a real device, at the
accepted cost that Android blocks `getUserMedia` without HTTPS - the
live camera background shows its error toast there; every other
background works.

## Vendoring into an app

Apps do not depend on this package; each adopting app holds a **verbatim
copy** of `design.css` next to its `index.html` and links it before its
own `<style>`:

```bash
pnpm run vendor                            # refresh every app that holds a copy
pnpm run vendor -- GpsPlusSlamJs_SomeDemo  # add an app, then refresh all
```

A copy rather than a workspace dependency (adoption plan DEC-L2-3): a
dependency would make every taste tweak here run every consuming app's
gate - `test:changed` runs a package plus its dependents - while this
package's gate is seconds-cheap on purpose. The copy pins each app to
the revision it chose. `tests/repo-config/design-css-copies.test.js` is
what makes it safe: byte-identical to this file, every linker holds a
copy, every copy is linked, and the link precedes the app's `<style>` so
the `@layer` order is fixed first. The app list is the filesystem - every
`GpsPlusSlamJs_*/design.css` - so neither the script nor the guard
hard-codes it.

Linking the sheet is **not automatically invisible**: its `reset` and
`base` layers land wherever an app left a browser default (measured on
the pilot: `box-sizing`, body `font-weight`, `h1` weight). The
mechanism step pins those in the app's own CSS; the restyle removes the
pins as it adopts the atoms.

## Hard constraint carried from the real apps

`backdrop-filter` is banned in anything meant for the immersive path: in
a real WebXR DOM overlay the HUD is composited as a separate surface in
front of the camera and cannot read the pixels behind it, so frosted
glass works on a desktop and silently does nothing on the device. This
is normative, not folklore - the WebXR DOM Overlays spec states that
backdrop filter effects "do not modify the AR camera image":
https://www.w3.org/TR/webxr-dom-overlays-1/
Translucency here is plain alpha only.
