# asset-optimizer-check-page.ts

**Purpose:** the wiring of the asset optimizer check page (`asset-optimizer-check.html`, described in full in `asset-optimizer-check.html.md`): the picture, sound and 3D model sections, the large model view and the e2e hook. The page loads it as its one module script; importing it starts the page (a side-effect entry, listed as a knip entry).

## Public API

None as exports. On import it:

- wires the page's buttons, file inputs, sliders and checkboxes (it throws with words when an expected element id is missing: `the page has no #<id>`);
- installs `window.assetOptimizerCheck` for `playwright-tests/editor-asset-optimizers.spec.js` (the members are listed in `asset-optimizer-check.html.md`, "For the e2e");
- says "Ready." in `#status`.

## Invariants

- The optimizers are the editor's shipped rows (`ASSET_OPTIMIZERS`) through the real Worker; only the swept field of `OPTIMIZER_SETTINGS` changes.
- The large view's state lives in `model-compare-view.ts` (a pure reducer); three.js objects, the made variants' cache and the fixed-drawing renderer are resources held in this module.
- A run disables only the controls of its own section that were enabled, marks the section `aria-busy`, says a failure in words, and enables those controls again either way.
- Only the editor page loads this module: `playwright-tests/e2e-plan.js` counts it as editor-only, and `tests/repo-config/tour-viewer-e2e-plan.test.js` holds that no other page reaches it.

## Tests

- `playwright-tests/editor-asset-optimizers.spec.js` drives it through the hook and the page.
- Its pure parts are unit-tested in `asset-optimizer-check.test.ts`, `asset-optimizer-check.property.test.ts` and `model-compare-view.test.ts`.
