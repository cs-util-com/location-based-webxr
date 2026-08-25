# code-param.ts

## Purpose

The `&c=<n>` printed-code discriminator (QD-6): selects which `qr/<c>.json`
level a launch or a detected code refers to.

## Public API

- `DEFAULT_CODE_DISCRIMINATOR = "1"`.
- `codeFromSearch(search): string` — from a query string; absent/empty ⇒
  the default (a printed URL must never dead-end over a missing param).
- `codeFromDetectedText(text): string` — from a DETECTED code's decoded
  launch URL; non-URL text or a URL without `c` falls back to the default.

## Invariants & assumptions

- Never returns an empty string (property-tested).
- The DETECTED code's discriminator wins over the page's own launch param:
  a tour can carry several printed codes, and the one in front of the
  camera is the one the visitor is relocalizing against.

## Examples

```ts
codeFromSearch(location.search); // page launch → "2"
codeFromDetectedText("https://…/tour/?qr=x&c=3"); // scanned code → "3"
```

## Tests

`code-param.test.ts` — defaults, explicit values, non-URL fallback, and the
never-empty property.
