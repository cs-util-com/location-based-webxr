# Start page V3: device-aware front door

A throwaway UX prototype of the Tour Viewer's start page (`/tour/`). It is linked from nothing in the app; the prototypes gallery (`../index.html`) lists it.

- `index.html`: the real start page's markup with one change, the hero's main button and the line under it, which depend on the device. The setup steps' insides, the editor entry and AR are faked. Its notes panel holds the measurements and the weaknesses.
- `v3.js`: the page's behaviour, the prototype switches and the faked steps.
- `real/`: generated copies, never edited by hand.
  - `landing.js` and its `landing-*.js` chunks: the Tour Viewer's real `mountLanding` (film, story cards, use cases), `linkQrSvg` and `isComputerScreen` (`src/link-qr.ts`) and `wireSetupStage` (`src/setup-stage.ts`), bundled and minified with esbuild 0.28.1 (ESM, code splitting). three.js 0.185.1 is bundled, tree-shaken, into the film chunk. All JS together is about 204 kB gzip.
  - `page.css`: `src/design.css`, the inline style block of `index.html`, then the landing modules' CSS, with comments removed.
  - Both were made from the source of commit 5cca8fd59. A change to the real page does not reach this copy, by design: a prototype shows one moment.
