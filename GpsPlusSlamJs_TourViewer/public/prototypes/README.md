# Tour Viewer design prototypes (inspiration gallery)

Standalone HTML drafts made for the owner to choose a direction (polish
round M1; the rule: root `CLAUDE.md` "Throwaway UX prototypes"). They are
served at `/tour/prototypes/`, linked from nothing in the app, and NOT
wired into its logic: every interaction is faked.

- `index.html` - the list.
- `landing-1-editorial/` ... `landing-5-map-path/` - the creator's entry
  and setup page, five visual directions. The app took L5.
- `hud-1-chips/`, `hud-2-bottom-sheet/`, `hud-3-drag-surface/` - the AR
  authoring overlay. The app takes H1, with an action strip.
- `scan-1-centre-card/`, `scan-2-viewfinder/`, `scan-3-coach-mark/` - the
  visitor's scan overlay. The app takes S1.
- `visitor-1-poster/` ... `visitor-4-one-tap/` - the visitor's start page
  (after scanning a poster), four directions; made 2026-10-12. The app
  took V4.
- `editor-1-left-rail/`, `editor-2-right-inspector/`,
  `editor-3-bottom-strip/` - the desktop editor (M6, before E1), all "full
  map, floating panels", differing in where the list and the editing card
  sit; made 2026-10-13. The app takes `editor-1-left-rail`.
- `editor3d-1-studio/`, `editor3d-2-walk-it/`, `editor3d-3-storyboard/`,
  `editor3d-4-map-tilt/` - the 3D editor on the globe (stations as groups
  of items, codes apart), four directions on a faked town; made
  2026-10-18, before the build. They load three.js from unpkg by an import
  map.

**Kept, the chosen and the unchosen** (owner, 2026-10-11 evening): another
developer may prefer a variant the owner did not choose and ask their own
coding agent to build that one. The verdicts are in the polish-round plan
(private docs).

**What goes with them:** the `public/prototypes/` lines in the package's
`.prettierignore` and `.stylelintignore`, and the `landing-5-map-path`
and three `editor3d-*` entries of `tests/repo-config/slider-pages-load-the-guard.test.js` (`EXEMPT`).
The drafts are not held to the app's lint and format rules.

**Owner rule applied after the build:** the three HUD drafts first blocked
placing until the code was measured; that contradicts the owner's rule of
2026-10-09 (placing never depends on a code) and was lifted.
