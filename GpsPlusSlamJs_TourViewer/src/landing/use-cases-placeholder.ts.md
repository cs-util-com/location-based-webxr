# landing/use-cases-placeholder.ts

## Purpose

The use cases' stand-in: `landing-mount.ts` loads it in place of the use
cases' module until that is wired. The host keeps the short static list
that `index.html` writes in it.

## Public API

- `mountUseCases(host): { destroy() }` - marks the host `data-uses="static"`;
  `destroy()` removes the mark.

## Invariants & assumptions

- Changes nothing the reader sees, so the reserved layout does not move.

## Examples

```ts
const part = mountUseCases(document.getElementById("landing-uses")!);
part.destroy();
```

## Tests

- `landing-mount.test.ts` - mounted through the shim's default loaders.
