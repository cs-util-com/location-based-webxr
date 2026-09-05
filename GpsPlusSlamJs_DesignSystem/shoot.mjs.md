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
  - **Finite animations are finished before every shot** (Web Animations
    `finish()` on each `document.getAnimations()` entry whose iteration
    count is not infinite), so an atom that arrives with an entrance
    animation - the annotation text fades in after a delay - is
    photographed in its settled state, not as an empty spot. Infinite
    animations keep running; their steady state is the shot.
  - `deviceScaleFactor` 2 (3 for `--sel`) so hairlines and 1px details
    survive into the PNG.
  - PNGs are NEVER committed and NEVER asserted against: headless-GPU
    output differs per machine, the same reason shoot-chapters.mjs
    rejected golden-image CI. Eyeball tool, not a gate - EXCEPT that
    console errors and page errors fail the run (exit 1), because they
    are deterministic where pixels are not. The page's keep-in-sync
    atom-drift assertion (data-atom / data-atom-copy pairs) reports
    through exactly this channel, so drift between the atoms column
    and the screens is caught headlessly. The two SOURCE checks that
    used to live here (colour literals outside the tokens layer,
    brief-vs-CSS token names) are now `check-tokens.mjs`, a real gate
    stage; shoot imports it for the side effect so it still fails fast
    on them before any browser work.
  - `--bg=live` is **rejected with exit code 2**, deliberately (PR #371
    review). It is not shootable: the page never restores `live` from the
    hash (a camera needs a user gesture) and `startLive()` runs only from
    the LIVE button's click handler, which headless has nobody to press.
    The old claim here - that the shot "shows the failure state" - was
    wrong: it rendered the plain `foliage` default and saved it as
    `phone-<screen>-live.png`, a different background under a filename
    claiming otherwise. Refusing is the only outcome that cannot mislead.
- Examples: `pnpm run shoot -- --screen=experiments --bg=night` (one
  screen, one background); `pnpm run shoot -- --sel=".hud-compass"`
  (close-up).
- Tests: none (tool, not production); exercised by every design round
  that reads its output back.
