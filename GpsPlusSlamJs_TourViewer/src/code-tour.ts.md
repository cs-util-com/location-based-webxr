# code-tour.ts

## Purpose

Which tour a printed code names, in the form an open tour's link has, so the
creator's step 4 can open a tour from its code and tell the open tour's code
from another tour's (TourViewer scan-to-open plan,
`GpsPlusSlamJs_Docs/docs/2026-09-27-0725-tour-viewer-creator-scan-to-open-plan.md`
§9 #2, #6).

## Public API

- `DEFAULT_ASSET_PREFIX` - the prefix a bare-name `?qr=` payload resolves
  under. One copy: `archive-open.ts`'s `?qr=` boot imports it.
- `launchPayload(text): string | null` - the trimmed `qr` parameter of a
  launch link, or null when `text` is not a URL or carries no payload.
- `resolveCodeTour(text, corsProxyBaseUrl): Promise<CodeTour>` - never
  rejects:
  - `{kind: "not-a-tour-code"}` - no launch link (a third-party code);
  - `{kind: "unreadable"}` - a launch link whose payload the framework's
    `resolveQrPayload` refuses (or throws on);
  - `{kind: "tour", url, normalizedUrl, comparable}` - `url` is the link as
    resolved (what the open path and step 1's field take); `normalizedUrl`
    is the comparison key: `comparableUrl(normalizeShareUrl(url,
{corsProxyBaseUrl}))` - `archive.url`'s form with the spellings that
    still name one file folded together; `comparable` is false for hosts
    that reach the file only through a redirect or whose normalised form
    depends on the spelling (short links, OneDrive).
- `tourRelation(code, openArchiveUrl | null): TourRelation` - `not-a-tour`,
  `no-tour-open`, `this-tour`, `other-tour`, or `unknown` (the links differ
  and one side cannot be compared, so neither is proven).

## Invariants & assumptions

- **The comparison key** (module-private `comparableUrl`) folds GitHub's
  `refs/heads/<branch>` into `<branch>` (the print step's shrunk form
  decodes with it) and drops a Dropbox link's `st` and `dl` (they differ
  between copies of one share; milestone review #7).
- **A tour's own code is always `this-tour`**, for any http(s) link and any
  of Google Drive's three spellings of one file. Comparing links as written
  broke this for Drive, and "other tour" locks Save.
- "Another tour" is claimed only when both links are comparable; either side
  on a redirecting host gives `unknown`, which the caller must not treat as a
  reason to lock Save.
- Pure: no DOM, no session state, no cache. The caller keeps the page-lifetime
  cache of text -> `CodeTour` (`archive-open`).
- The `corsProxyBaseUrl` must be the one the open path uses, or the Drive
  forms will not compare equal.

## Examples

```ts
const code = await resolveCodeTour(detectedText, DRIVE_PROXY_BASE_URL);
switch (tourRelation(code, ctx.session?.archive.url ?? null)) {
  case "no-tour-open": // open code.url
  case "other-tour": // switch, or say it belongs to another tour
  case "this-tour":
  case "unknown":
  case "not-a-tour":
}
```

## Tests

- `code-tour.test.ts` - payload reading, the three outcomes, the bare-name
  prefix, the Drive spellings as one tour, another Drive file as another
  tour, `unknown` on either side's redirecting host.
- `code-tour.property.test.ts` - any http(s) link, encoded by the print
  step's own `planPrintCode`, is `this-tour` against the tour opened from
  that link; any string resolves
  without throwing.
