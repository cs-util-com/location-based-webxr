# shoot-3d.mjs — screenshots of the 3D look-dev page

- Purpose: render every look preset under every tone map (AgX, ACES,
  Neutral), from two camera views, so a
  look can be judged side by side and each taste round leaves a record
  (plan 2026-09-23-0048, DEC-SKY-11).
- Public API (CLI): `pnpm run shoot:3d [-- --preset=<id>] [--tone=<agx|aces|neutral>] [--view=<city|sun>] [--parity]`.
  Writes `shots/3d/<preset>-<tone>-<view>.png` (gitignored) and prints
  each path. With
  `--parity` it also prints the GPU/CPU LUT comparison as JSON.
- Invariants & assumptions:
  - Starts its own `serve.mjs` on the aux port 5198, bound to 127.0.0.1
    (`docs/dev-server-ports.md`), and kills it afterwards; it never reuses
    a server left running for a phone round.
  - An eyeball tool, not a gate: headless Chromium rasterises on the CPU,
    so pixels differ per machine and frame times mean nothing for a phone.
    Console and page errors DO fail it (exit 1), because a shader compile
    error only ever shows up as a console line.
  - Two animation frames after each change before the screenshot.
- Examples: `pnpm run shoot:3d -- --preset=golden --view=sun` → two PNGs
  per tone map. (Baseline shots of OsmDemo's old sky were retired with it
  in M3.)
- Tests: none (tool). The same page is gated by `3d/lookdev.smoke.spec.mjs`.
