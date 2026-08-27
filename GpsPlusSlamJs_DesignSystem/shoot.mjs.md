# shoot.mjs — headless screenshot harness for the design-system page

- Purpose: render `index.html` in headless Chromium and save PNGs, so an
  agent (or a human in a hurry) can SEE what an edit produced without
  opening a browser. Modeled on
  `GpsPlusSlamJs_Landing/scripts/shoot-chapters.mjs`, but simpler: the
  page is static, so it loads via `file://` and needs no dev server. The
  page's own URL-hash state (`#bg=…&screen=…`) addresses backgrounds and
  screens directly.
- Public API (CLI): `pnpm run shoot [-- --screen=<hud|experiments|placement>]
[--bg=<foliage|wall|sky|night|live>] [--sel=<css-selector>] [--page]`.
  Default: the `#phone` element on every screen over foliage. `--sel`
  shoots the first matching element at 3x device scale; `--page` shoots
  the full page including the atoms column. Output paths are printed one
  per line; files land in `shots/` (gitignored).
- Invariants & assumptions:
  - `deviceScaleFactor` 2 (3 for `--sel`) so hairlines and 1px details
    survive into the PNG.
  - PNGs are NEVER committed and NEVER asserted against: headless-GPU
    output differs per machine, the same reason shoot-chapters.mjs
    rejected golden-image CI. Eyeball tool, not a gate - EXCEPT that
    console errors and page errors fail the run (exit 1), because they
    are deterministic where pixels are not. The page's keep-in-sync
    atom-drift assertion (data-atom / data-atom-copy pairs) reports
    through exactly this channel, so drift between the atoms column
    and the screens is caught headlessly. Two SOURCE checks also run
    before any browser work: color literals in the atoms/screen layers
    (must be var(--token); comments and mask stencils exempt, demo
    layer exempt) and brief-vs-CSS token-name drift (every --name the
    brief mentions must exist in styles.css). Both negative-tested.
  - `--bg=live` renders the getUserMedia background, which headless
    Chromium will fail to open; the page surfaces that in its toast, and
    the shot shows the failure state — that is honest, not a bug.
- Examples: `pnpm run shoot -- --screen=experiments --bg=night` (one
  screen, one background); `pnpm run shoot -- --sel=".hud-compass"`
  (close-up).
- Tests: none (tool, not production); exercised by every design round
  that reads its output back.
