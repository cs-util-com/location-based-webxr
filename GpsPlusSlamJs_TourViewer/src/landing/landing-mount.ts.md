# landing/landing-mount.ts

## Purpose

The landing's one static module: `main.ts` calls `mountLanding`, which
loads the landing's moving parts (the step cards' pictures, the hero film,
the use cases) with dynamic imports, for a creator only. A visitor's page
(`?qr`) never downloads them. The landing's text, its reserved boxes and the
film's still are static in `index.html` and show without this module.

## Public API

- `mountLanding({ mode, dom, reducedMotion, onArStarting, loaders? })`
  returns `{ ready, destroy() }`.
  - `mode !== "creator"` or `dom === null`: loads nothing, `ready` resolves.
  - `dom` - `{ film, cards, uses }`: the film's host (`#landing-film`), the
    cards' list (`.landing-cards`) and the use cases' host
    (`#landing-uses`).
  - Mounts the film with `{ reducedMotion, onArStarting }`, the cards with
    `{ reducedMotion, filmHost }` (so no card moves while the film plays)
    and the use cases with their host.
  - Each host gets `data-mount="ready"`, or `"failed"` when its chunk did
    not load or its mount threw; a failed part keeps the host's static
    content.
  - `ready` settles once every part mounted or failed; it never rejects.
  - `destroy()` destroys every mounted part and removes the marks; a part
    whose load settles after `destroy()` is destroyed at once.
- `LANDING_LOADERS` - the default loaders: `./landing-cards.js`,
  `./use-cases.js` (the section replaces the host's static list, its
  heading with it) and `./film-placeholder.js` until the film lands (a
  one-line change here).
- `watchArStarting(document)` - the page's "AR is starting" signal in the
  film's shape, `(stop) => unregister`: a capture-phase click on or inside
  `#enter-ar`, and `body[data-ar-active="true"]` (written by `ar-entry.ts`)
  for a session started another way.
- Types: `LandingPart`, `LandingFilmOptions`, `LandingCardsOptions`,
  `LandingLoaders`, `LandingDom`, `MountLandingOptions`, `MountedLanding`.
  The film's and the use cases' modules implement `LandingFilmOptions` and
  `mountUseCases(host)`; their own type imports from here are type-only,
  which the cycle check (`dpdm -T`) leaves out.

## Invariants & assumptions

- The only `src/landing/` modules in the main page's static graph are this
  one and `landing-skip.ts` (`card-play.ts` and `clamp01.ts` are allowed
  there too, and today ride in the cards' chunk); `editor3d-lazy.test.ts`
  asserts it on the built bundle.
- `src/landing/` must not import the editor (`landing-not-to-editor` in
  `config/.dependency-cruiser.cjs`).
- The film's chunk loads in parallel with the cards' chunk; the cards read
  the film's `data-playing` as it changes, so the order does not matter.

## Size

- The landing's dynamic chunks together (the cards' pictures, the use
  cases, the film's stand-in), gzipped as the unminified test build writes
  them, measured 26.3 kB on 2026-10-26; the budget in
  `editor3d-lazy.test.ts` is 32 kB (about a fifth of headroom). It is an
  upper bound: the shipped build is minified, and the chunks' CSS files are
  not counted. The film sets it anew when it lands, under the start page's
  ceiling of 250 kB gzip for the landing's own code (three.js, already on
  the page, excluded).

## Examples

```ts
mountLanding({
  mode,
  dom: { film, cards, uses },
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  onArStarting: watchArStarting(document),
});
```

## Tests

- `landing-mount.test.ts` (jsdom) - nothing loads for a visitor or without
  a landing; each part gets its host and options; a failed chunk keeps the
  static content and the others mount; destroy, also before a load
  settles; the real default chunks mount and unmount; the AR signal on a
  tap, on a live session, and not after unregistering.
- `playwright-tests/landing.spec.js` - a visitor's page requests no landing
  chunk; a creator's page mounts the pictures.
