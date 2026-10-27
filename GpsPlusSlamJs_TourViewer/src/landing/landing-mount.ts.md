# landing/landing-mount.ts

## Purpose

The landing's one static module: `main.ts` calls `mountLanding`, which
loads the landing's moving parts (the step cards' pictures, the hero film,
the use cases) with dynamic imports, for a creator only. A visitor's page
(`?qr`) never downloads them. The landing's text, its reserved boxes and the
film's still are static in `index.html` and show without this module.

## Public API

- `mountLanding({ mode, dom, reducedMotion, watchReducedMotion?, onArStarting, loaders? })`
  returns `{ ready, destroy() }`.
  - `mode !== "creator"` or `dom === null`: loads nothing, `ready` resolves.
  - `dom` - `{ film, cards, uses }`: the film's host (`#landing-film`), the
    cards' list (`.landing-cards`) and the use cases' host
    (`#landing-uses`).
  - Mounts the film with `{ reducedMotion, onArStarting, onFallback }`
    (`onFallback` marks the host `data-film-fallback="no-webgl"` or
    `"context-lost"`, removed on destroy and before a reduced-motion
    remount, so only the mounted film's reason stands), the cards with
    `{ reducedMotion, filmHost }` (so no card moves while the film plays)
    and the use cases with their host.
  - Each host gets `data-mount="ready"`, or `"failed"` when its chunk did
    not load or its mount threw; a failed part keeps the host's static
    content.
  - `ready` settles once every part mounted or failed; it never rejects.
  - `watchReducedMotion(onChange)` - where given, the reader's setting is
    followed while the page is open: on a change the film and the cards
    are destroyed and mounted again with the new value (the use cases do
    not move and stay). A mount that lands after a newer one was asked for
    is destroyed, so each host holds one part. `main.ts` passes the
    `(prefers-reduced-motion: reduce)` query's `change` event.
  - `destroy()` destroys every mounted part and removes the marks; a part
    whose load settles after `destroy()` is destroyed at once.
- The default loaders (module-private, replaced by `loaders` in tests): `./landing-cards.js`,
  `./use-cases.js` (the section replaces the host's static list, its
  heading with it) and `./landing-film.js`.
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

- The landing's dynamic chunks' JavaScript together (the cards' pictures,
  the use cases, the film, and a shared helper), gzipped as the unminified
  test build writes it, measured 61.7 kB on 2026-10-26 (the film's chunk
  35.0 kB, the cards' 11.4, the use cases' 14.1, the shared drawn code
  1.2); the budget in `editor3d-lazy.test.ts` is 74 kB (about a fifth of
  headroom). It counts JavaScript only and bounds it from above: minified,
  as shipped, the same chunks are 43.8 kB (the film 24.4). Not counted:
  the chunks' CSS (minified: film 3.4 kB, cards 3.7, use cases 0.9), the
  hero's still drawings (`public/landing/hero-still-*.svg`, 15.7 and
  16.0 KiB gzip; a creator's page fetches the one for its layout), and
  three.js: the film imports it from `three.core` and the shared
  renderer chunk, both already in the main page's static graph, so the
  film adds no three.js download. All of it is under the start page's
  ceiling of 250 kB gzip for the landing's own code.

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
  tap, on a live session, and not after unregistering; a change of the
  reduced-motion setting mounts the film and the cards again with it, one
  part per host also when the change lands during a load.
- `playwright-tests/landing.spec.js` - a visitor's page requests no landing
  chunk (and the same filter sees a creator's page fetch them); a creator's
  page mounts the pictures.
