# content-disposition.ts

## Purpose

The hosted file's name from a `content-disposition` header, and whether a
phone keeps that name when it saves the rebuilt zip (TourViewer Drive
replace plan,
`GpsPlusSlamJs_Docs/docs/2026-09-28-0653-tour-viewer-drive-replace-flow-plan.md`
§2 decision 3, §5 #7). Drive offers "Replace" only when the uploaded file
has the SAME name as the one in Drive, and a Drive link carries no name - so
the rebuilt zip takes the name from the host's header.

## Public API

- `fileNameFromContentDisposition(header: string | null): string | null` -
  the name, or null (no header, no name, empty, or unsafe).
  - RFC 6266 with RFC 8187: parameter names case-insensitive; `filename`
    as a token or a quoted string (backslash escapes undone); `filename*`
    as `charset'language'percent-encoded` in UTF-8 or ISO-8859-1.
  - `filename*` wins; a malformed or unsafe one falls back to `filename`.
  - Never throws.
- `nameSurvivesDownload(name: string): boolean` - true when saving a file
  of this name on a phone keeps it exactly: it ends in `.zip` (any case)
  and has none of `< > : " | ? *` (Chrome replaces those, and may append
  `.zip` to a name without one).

## Invariants & assumptions

- **Never a path:** a name with `/`, `\` or a control character is refused
  - a header must not steer a download outside the Downloads folder.
- The page cannot see the name a download was finally saved under (no save
  picker on Android): `nameSurvivesDownload` is the only warning it can
  give, and a repeat download's " (1)" suffix is not predictable at all
  (plan §5 #1) - the Drive steps tell the creator to check for it.

## Examples

```ts
fileNameFromContentDisposition(`attachment; filename*=UTF-8''My%20tour.zip`);
// "My tour.zip"
nameSurvivesDownload("Altstadt Tour"); // false - rename it to .zip first
```

## Tests

`content-disposition.test.ts`: every header form above, `filename*`
precedence and fallback, refused names; properties - any string never
throws and never yields a path, and any safe name round-trips through the
RFC 8187 form; the survival cases.
