# GpsPlusSlamJs_DesignSystem

The HUD design system for the AR apps in this workspace, kept deliberately
as **one vanilla HTML file** (`index.html`) so it can be iterated at
conversation speed: open it in a browser, react, edit, refresh. No build,
no framework, no dependencies at runtime.

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

Edit `index.html`, refresh the browser. One change-set per reaction; the
gate is prettier only (`pnpm test`), on purpose — this is a taste
instrument, not production code. Design decisions and their history live
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
rejected because headless-GPU output differs per machine.

## Hard constraint carried from the real apps

`backdrop-filter` is banned in anything meant for the immersive path: in
a real WebXR DOM overlay the HUD is composited as a separate surface in
front of the camera and cannot read the pixels behind it, so frosted
glass works on a desktop and silently does nothing on the device.
Translucency here is plain alpha only.
