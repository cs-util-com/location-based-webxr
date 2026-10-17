# tour-details.ts

**Purpose:** the checks for a tour's details - `description`, `cover` and
`contact` (tour editor plan 2026-10-17-1816, W2, decision D15) - shared by
the manifest's reader and writer (`tour-manifest.ts`, minor 3) and by an
app's own fields (the Tour Viewer editor's "Tour details" dialog), so what
an editor accepts is exactly what a reader keeps (DEC-H3). Kept apart from
`tour-manifest.ts` so a later format version (stations as parents, the
plan's W3, version 3) reads the same fields with the same parsers
unchanged (plan review 2 #10).

## Public API

- `TourDetails` - `{ description?, cover?, contact? }`; `TourManifest`
  extends it.
- `checkTourDescription(value): TourDetailCheck` - text, trimmed,
  non-empty, at most `TOUR_DESCRIPTION_MAX_CHARS` (2000) characters
  counted as code points (an emoji is one); line breaks kept.
- `checkTourContact(value): TourDetailCheck` - text, trimmed, at most
  `TOUR_CONTACT_MAX_CHARS` (320), and either an e-mail address (bare or
  `mailto:`, any case) or an `http:`/`https:` link with a host and no user
  name or password (a link carrying a user name reads as one host and
  opens another). Kept as typed (trimmed).
- `checkTourCover(value, imageIds): TourDetailCheck` - a path-safe id
  (`[A-Za-z0-9_-]{1,64}`) that is one of `imageIds`.
- `tourContactHref(contact): string | null` - where a contact leads:
  `mailto:<address>` (with `% ? # &` in the address percent-escaped, RFC 6068) for an e-mail address, the link itself otherwise, null for a value
  the check refuses.
- `tourImageIds(tour): Set<string>` - the ids a cover may name: the
  placed photos' (`kind: 'photo'`) and the image assets' (`kind:
'image'`). `tour` is structural (`TourImages`: `objects`, `assets`), so a
  later format version passes its own records.
- `tourCoverEntry(tour): string | null` - the archive entry the cover
  shows (a photo's `image`, an asset's `path`), or null without a cover
  that names an image (the visitor's start page falls back to its own
  choice then).
- `parseTourDetails(data, { imageIds }): { details, dropped }` - the three
  fields of a document record, each checked; an absent (undefined) field is
  absent, a failing one is dropped as `TourDetailsDrop { field, reason }`.
  Never throws.
- `TourDetailCheck` (`{ ok: true, value } | { ok: false, reason }`),
  `TourDetailsDrop`, `TourDetailsField`.

## Invariants & assumptions

- **A detail costs itself, never the tour.** Readers drop a failing value
  with a reason instead of throwing, at every minor: the details are
  cosmetic, and a cover photo deleted on the phone must not stop the tour
  opening. The manifest's writer is stricter (see `tour-manifest.ts.md`).
- **Idempotent.** A kept value passes its own check again unchanged, so a
  written tour reads back the same (property-tested).
- **A kept contact leads only to `mailto:` or an http(s) page**, never a
  script or a data URL (property-tested); it is shown as a link by the
  visitor's error messages.
- The e-mail rule accepts RFC 5322's dot-atom local part (letters, digits
  and `!#$%&'*+-/=?^_\`{|}~.`), not a quoted one, and a dotted domain of
  letters (any script), digits and hyphens with a final label of two or
  more. Not a full RFC validator: a mistyped but well-formed address passes.
- `imageIds` is the caller's: `tour-manifest.ts` passes its placed photos'
  ids and its image assets' ids. A later version passes its own.

## Examples

```ts
checkTourContact(' guide@example.org '); // { ok: true, value: 'guide@example.org' }
checkTourContact('javascript:alert(1)'); // { ok: false, reason: '"contact" must be ...' }
tourContactHref('guide@example.org'); // 'mailto:guide@example.org'
parseTourDetails({ cover: 'gone' }, { imageIds: new Set(['f1']) });
// { details: {}, dropped: [{ field: 'cover', reason: '"cover" names no image of this tour' }] }
```

## Tests

- `tour-details.test.ts` - each check's accepted and refused values (the
  contact's script, data, ftp, user-name and query forms among them), the
  character count by code point, the href forms and the escaping of `&`
  and `?`, a document without details, and a failing value dropped with
  its reason beside the kept ones; the image ids (photos and image assets,
  never a pin or an audio asset) and the cover's entry.
- `tour-details.property.test.ts` - over any input: never throws, every
  given field is kept or dropped, a kept value passes its check unchanged;
  a kept contact leads only to `mailto:` or http(s); every generated e-mail
  address and https link within the cap is kept.
- `tour-manifest.test.ts` / `tour-manifest.property.test.ts` - the fields
  in `tour.json` (minor 3).
