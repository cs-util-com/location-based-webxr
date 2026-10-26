# landing/film-placeholder.ts

## Purpose

The hero film's stand-in: `landing-mount.ts` loads it in place of the film
until the film's module is wired. The film's host keeps the static still
that `index.html` draws in it.

## Public API

- `mountLandingFilm(host, options): { destroy() }` - the film's interface
  (`LandingFilmOptions` in `landing-mount.ts`). Marks the host
  `data-film="still"` and registers an AR-start callback that does nothing;
  `destroy()` unregisters it and removes the mark.

## Invariants & assumptions

- Never sets `data-playing` on the host, so the cards never wait for it.
- Draws nothing and requests no frames.

## Examples

```ts
const part = mountLandingFilm(host, { reducedMotion, onArStarting });
part.destroy();
```

## Tests

- `landing-mount.test.ts` - mounted through the shim's default loaders,
  with its mark and its AR registration undone by `destroy()`.
