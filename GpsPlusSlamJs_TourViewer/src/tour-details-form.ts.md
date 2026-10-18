# tour-details-form.ts

**Purpose:** a tour's details as the pages edit them - the name,
description, cover and contact a manifest carries, the form a page's
fields fill, and the one check that turns a form into the details to keep.
Lifted out of `editor/` (it was `editor-session.ts`'s and
`editor-draft.ts`'s) so the shared tour document (D30) and both pages use
one rule set: outside `editor/` because the viewer side may not import the
editor (`.dependency-cruiser.cjs`, `viewer-not-to-editor`). Pure.

## Public API

- `TourDetailFields` - `{ title?, description?, cover?, contact? }`: the
  manifest's own fields, each present only when the tour carries it (the
  draft's settings record holds the same shape, `editor/editor-draft.ts`).
- `DETAIL_FIELDS` - `["title", "description", "cover", "contact"]`, the
  order a page and a restore offer name them.
- `DetailsForm` - `{ name, description, cover: string | null, contact }`,
  a form's values; an empty text (or a null cover) is "none"
  (`editor/details-dialog.ts` fills it).
- `detailsOf(manifest): TourDetailFields` - the details a manifest carries.
- `withDetails(manifest, details): TourManifest` - a copy carrying
  `details` in place of its own; an absent field is removed.
- `checkDetailsForm(form, covers, was, unknownCover = "refuse")` -
  `{ ok: true, details }` or `{ ok: false, reason }` in plain words (never
  the format's field names in quotes):
  - the name trimmed, by the framework's `checkTourTitle` (at most
    `TOUR_TITLE_MAX_CHARS` = 80 characters counted as code points, not
    graphemes: a flag or a family emoji built of several code points counts
    as several, as the format's reader counts it); a name
    equal to `was.title` passes whatever its length (a tour named longer
    elsewhere, M4a review #10);
  - the description and the contact by `checkTourDescription` /
    `checkTourContact`; a contact's refusal says whether it is the length
    or the form;
  - the cover kept when it is one of `covers`; otherwise refused, or with
    `"drop"` (a draft's record, whose photo may have gone) left out.

## Invariants & assumptions

- **One rule set, the format's own** (DEC-H3): what this accepts, the
  manifest's reader keeps. The title cap is an EDITOR rule only: the
  reader keeps a longer title (`tour-details.ts.md` in the framework).
- Pure: nothing is mutated, `withDetails` copies.
- A form accepted once is accepted again unchanged when built back from
  its own details (property-tested).

## Examples

```ts
checkDetailsForm(
  { name: " Old town ", description: "", cover: null, contact: "" },
  new Set(),
  {},
); // { ok: true, details: { title: "Old town" } }
withDetails(manifest, detailsOf(manifest)); // equal to manifest
```

## Tests

- `tour-details-form.test.ts` - the four fields read and written back,
  the name counted by code point (80 emoji kept, 81 refused), a long name
  the tour carries kept, each refusal's words, a draft's cover dropped;
  properties: `detailsOf(withDetails(m, d))` is `d`, and an accepted form
  is accepted again unchanged.
- Through the editor: `editor/editor-session.test.ts` ("the tour details
  (W2)") and the parity contract `tour-document-parity.test.ts`.
