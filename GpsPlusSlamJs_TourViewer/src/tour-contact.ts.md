# tour-contact.ts

## Purpose

The tour's contact under a visitor's error message (tour editor plan
2026-10-17-1816, W2, D15). A tour may name a contact (an e-mail address or
an http(s) link, `tour.json` minor 3); while an error shows on the
visitor's page, the line under it names that contact as a link, so a
visitor knows who to ask.

## Public API

- `contactLink(contact): ContactLink | null` - `{ href, label }` for a
  contact a visitor may follow: `mailto:<address>` (reserved characters
  escaped) for an e-mail address, the link as the URL parser reads it for
  a web link (the framework's `tourContactHref`: `https:example.org`
  leads to `https://example.org/`, M4a review #4); `label` is the address
  without `mailto:`, or for a web link the same value as `href`, so the
  visitor reads the address they open. Null for no contact or one the framework's check refuses.
- `renderTourContact(dom, error, contact)` - shows the line (`dom.line`)
  with the link (`dom.link`) while `error` says something and the
  contact is followable; hides it otherwise. `main.ts` passes the error
  box's text, or "This tour is not finished yet." while the open tour is
  not finished (`tour-unfinished.ts`), so a visitor of an unfinished tour
  is told whom to ask too.
- `TourContactDom`, `ContactLink`.

## Invariants & assumptions

- Never a script or other scheme: only what `tourContactHref` accepts
  becomes an `href`; the label is written as text.
- The words in front of the link are `index.html`'s (`#error-contact`).
- An error said before the tour's manifest is read names no contact: the
  contact is inside the file. `main.ts` re-renders on every change of the
  error box (a `MutationObserver`) and whenever a tour is presented.
- The link opens in a new tab with `rel="noopener noreferrer"` (markup).

## Examples

```ts
renderTourContact(
  { line, link },
  errorBox.textContent ?? "",
  ctx.tourDocument.manifest()?.contact,
);
```

## Tests

- `tour-contact.test.ts` - e-mail and web links (a link shown as
  parsed), refused and absent
  contacts, shown only while an error shows.
- `playwright-tests/visitor-start.spec.js` - the details tour: the line
  appears under an error with a `mailto:` link and goes with the error;
  a tour not finished yet shows it under its start page's sentence.
