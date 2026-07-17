# `GpsPlusSlamJs_Landing/index.html` — root landing page (3D scroll story)

## Purpose

The entry document of the landing app served at the **root** (`/`) of
`gps.csutil.com`. It carries the entire chapter copy as **real DOM text**
(SEO, accessibility, and the no-WebGL floor — the plan's "Content in DOM"
decision), the per-palette CSS (five palettes, see `src/theme.ts`), and
the mount points for the 3D scroll story that `src/main.ts` boots behind
the copy.

## Structure

- `#scene-root` — fixed full-viewport layer the WebGL canvas is appended
  into (`aria-hidden`, z-index 0; hidden entirely under `body.no-webgl`).
- `.top-bar` — brand ("Location-based WebXR") + `#theme-toggle` palette-icon
  button (its `aria-label` announces the active palette).
- `#chapter-dots` — the fixed chapter progress rail (v3 F6): ships as an
  EMPTY `<nav>` (`:empty` hides it — progressive enhancement);
  `src/chapter-dots.ts` fills it at boot with one button per chapter,
  labels from `chapters.ts` as aria-labels. Active dot = accent; click
  scrolls to the chapter; smaller/tighter below 600 px.
- The hero also carries the `.hero-snippet` code block (v2 B3/B9,
  "Framework-Minimal"): the shortest REAL `gps-plus-slam-app-framework`
  sequence to a GPS anchor, hand-highlighted with `.hl-kw`/`.hl-lit`
  spans (comments `.c`; `createGpsAnchor` reuses `.hl-fused` red and the
  lat/lon literals `.hl-raw` amber — the page's color-coding invariant).
  Verified against `GpsPlusSlamJs_MinimalExample/src/main.ts` and the
  framework's `GpsAnchorOptions` (see the HTML comment above the block
  for exact line refs). Since round-9 R9-5 it is a `<details
  id="hero-snippet">` expander: ships COLLAPSED (phones keep their
  fold, no-JS floor safe), `src/hero-snippet.ts` opens it at boot on
  desktop-class viewports (>720×500).
- `<main id="story">` — seven `<section class="chapter" id="chapter-<id>">`
  in the order defined by `src/chapters.ts` (hero, qr, fusion, dive,
  anywhere, gallery, cta). The hero carries its content in a panel-less
  `.hero-content` block (normal-landing layout, round-2 R4); every other
  chapter carries a `.copy` glass panel with the punchy-marketing copy
  (round-2 interview decision). The active section gets `.active` (full
  opacity) from `main.ts`.
- The CTA section holds ONE primary "Fork & start building" button that
  carries the GitHub mark icon (round-9 R9-4 merged the former separate
  "Open source on GitHub" badge into it — the badge duplicated the
  button and was removed; still deliberately NO live star-count fetch),
  the demos hub (five `.demo-card`s with inline-SVG vignettes keeping
  the proven one-line descriptions), and the external links row
  (`.links`, which carries the story's terminal bottom padding). ALL
  external (https) links — primary CTA, links row, FAQ license link —
  open a NEW TAB (`target="_blank" rel="noopener"`, round-9: the landing
  stays open in the background; this also removes the bfcache-return
  trigger of the firefly freeze, see R9-6). Since round-10 R10-1 the
  five demo cards open new tabs as well (reversing the round-9 same-tab
  call): EVERY outbound click keeps the landing alive. Its lead sentence
  starts with `#cta-device-claim` (round-8 Z6): the static text is the
  universally-true Android+Chrome claim; `src/ar-support.ts` upgrades it
  to "run on your phone right now" only on immersive-ar-capable devices
  — the static default must ALWAYS stay universally true. The copy panel
  also ships an empty `#qr-handoff` container with the `hidden` attribute:
  `src/qr-handoff.ts` (v2 B2) fills it with a client-generated QR of the
  live URL on desktop-class devices without immersive-ar; on every other
  device (and with JS disabled) it stays invisible. Between the demos hub
  and the links row sits the compact FAQ (v2 B6): five native `<details>`
  accordions (devices, accuracy in the locked B10 qualitative wording,
  license, offline, how to start) — no JS. The license question
  consciously softens round-3's F-drop: license honesty returns in FAQ
  form (Apache-2.0 framework + bundled community-licensed core, details
  on GitHub), never as a footer disclaimer; the meta description keeps
  its factual "Apache-2.0 framework" mention for SEO/social.

- `<head>` carries the social-card meta (v2 B7): og:title/description/
  type/url/image + twitter summary_large_image. The og:url/og:image URLs
  are ABSOLUTE and hardcode the production origin `https://gps.csutil.com/`
  — the image lives at `public/og-card.png` (a curated
  `pnpm run shoot -- fusion` capture, dark palette, checked in
  statically). Regenerate it when the scene/copy changes materially;
  validate with a social-card validator after each deploy.

## Invariants & assumptions

- **FOUC guard:** the inline `<script>` in `<head>` applies the persisted
  (or OS-preferred) theme to `<html data-theme>` before first paint. Its
  resolution rule MUST stay in sync with `src/theme.ts`
  (`resolveInitialTheme`) — same storage key `gps-landing-theme`, same
  valid values, same fallback.
- **Theming:** all chrome colors go through CSS custom properties defined
  per `html[data-theme='dark'|'light']`; the accent `#ef4444` matches the
  3D palette's fused-anchor color.
- **Demo links** are root-absolute with trailing slashes (`/starter/`,
  `/minimal/`, `/qr-demo/`, `/recorder/`, `/physics/`) — deployment URLs on the
  shared origin, asserted by `scripts/build-site.mjs` after the production build.
- **Chapter sections** must exist for every id in `src/chapters.ts` (same
  order); `main.ts` warns on missing ones. Sections are min-height 130vh
  (hero 100vh) to give the scroll story room.
- `csstree/validator` disable comments on `clamp()` lines are false-
  positive suppressions (the bundled css-tree grammar rejects math
  functions), same as in the sibling apps.
- **2D polish package (v3 F5):** copy panels use a gradient border
  (padding-box/border-box double background — the `--panel-border-hi`
  vars) + saturated backdrop blur, and a soft rise+fade entrance on
  `.active` (the panel stays visible at ALL times — opacity floor 0.55 +
  14 px offset — so e2e visibility checks are unaffected; reduced motion
  drops the transform entirely). Buttons/badges/demo cards carry small
  hover/press transforms (reduced-motion-safe), `body::after` is a
  fixed SVG-noise grain overlay (opacity 0.035, pointer-transparent),
  and the hero H1 color spans glow faintly via `--hl-glow-*` vars that
  only the dark palettes define.

## Examples

`pnpm dev` in this package serves the page on port 5182. The production
build is `vite build` at base `/` orchestrated by `scripts/build-site.mjs`.

## Tests

- `lint:css` (stylelint + csstree) covers the inline CSS.
- The chapter-id contract is covered by `src/chapters.test.ts` +
  `main.ts`'s runtime warning; the demo-link presence is asserted both by
  the Playwright smoke suite and by the build-site guard after
  `pnpm run build:site`.
- `playwright-tests/scroll-story.spec.js` smoke-tests the rendered page:
  boot + chapter activation without console errors, canvas (or the
  no-WebGL floor), theme toggle persistence, reduced motion.
- Fine-grained visual quality (composition per chapter, both themes on
  real displays) remains the manual pass defined in the plan's
  verification section.
