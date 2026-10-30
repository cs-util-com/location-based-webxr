# long-text-render.ts

## Purpose

Builds a long text's body (the tree `parseTourMarkdown` reads, framework
`ar/tour-markdown`) into DOM nodes for the reading sheet, from a fixed
list of elements and attributes, with `createElement` and text nodes only.
No HTML string is ever parsed, so a tour file cannot put markup of its own
into the page: the safety holds by construction, not by a sanitizer's
settings. Also the link guard that asks before a link leaves an AR
session.

Design: `GpsPlusSlamJs_Docs/docs/2026-10-25-2052-station-blocks-build-plan.md`
(B3a) and the station blocks design §5.3 (links) and §5.5 (the allowlist).

## Public API

- `LONG_TEXT_ALLOWED` - every element the renderer makes, with the
  attributes it may carry: `p`, `h3`-`h5`, `ul`, `ol[start]`, `li`,
  `blockquote`, `em`, `strong`, `a[href,target,rel,referrerpolicy]`,
  `img[src,alt,loading]`, `br`, and `span` (no attributes).
  - `span` is not on the design's list: it is the box showing a picture's
    alt text where the picture cannot show (an inline picture, one not yet
    decoded, one over the cap or the decode budget).
- `renderLongText(doc, { document, onLinkTap }): RenderedLongText` -
  `{ fragment, pictures }`.
  - Headings render one level below the sheet's title: `#` as `h3`, `##`
    as `h4`, `###` as `h5`.
  - A soft break is a space, a hard break a `br`.
  - An ordered list carries `start` only when it does not start at 1.
  - A link gets `target=_blank`, `rel="noopener noreferrer"`,
    `referrerpolicy=no-referrer`, and its host after its text,
    `"Town archive (archive.example)"` (a phone cannot hover; a look-alike
    host shows in its ASCII `xn--` form, as the parser gives it). A click
    calls `onLinkTap(event, { href, host })`.
  - A block picture is a `p` holder with its alt text in a `span`, listed
    in `pictures` (`{ asset, alt, holder }`, document order) for
    `long-text-pictures.ts` to fill.
  - An inline picture (the parser's `pictureAlt`) is a `span` with its alt
    text; an empty alt shows as "picture" (`altBoxText`).
  - Never throws: a value that is not a tree renders an empty fragment,
    and a block or an inline of a kind the renderer does not know (a
    newer parser's, a hand-built tree's) is skipped.
- `altBoxText(alt)` - the alt box's text.
- `leaveArQuestion(host)` - "Open {host}? You may lose your place in the
  AR view."
- `createLinkGuard({ arActive, ask, open })` - the `onLinkTap` handler:
  outside AR it does nothing (the link opens by its own attributes); during
  an AR session it prevents the default, asks, and calls `open(href)` only
  on yes. A rejected question opens nothing.

## Invariants & assumptions

- Every element and attribute in the output is in `LONG_TEXT_ALLOWED`
  (pinned by a unit sweep and a property test over generated bodies).
- All text arrives through text nodes, so markup characters stay text.
- The parser has already checked links (https only, ASCII host) and
  pictures (`asset:` ids, at most 20); the renderer trusts the tree's
  shape but not its presence.

## Examples

```ts
const guard = createLinkGuard({
  arActive: () => document.body.dataset["arActive"] === "true",
  ask: (host) => askInSheet(leaveArQuestion(host)),
  open: (href) => window.open(href, "_blank", "noopener,noreferrer"),
});
const { fragment, pictures } = renderLongText(parseTourMarkdown(body), {
  document,
  onLinkTap: guard,
});
sheetBody.replaceChildren(fragment);
```

## Tests

- `long-text-render.test.ts` - each element, the link attributes and host,
  a punycode host, the tap hand-off, picture holders, inline alt boxes,
  escaped markup, an allowlist sweep, a non-tree input, unknown block and
  inline kinds skipped, and the link guard (outside AR, yes, no, a
  rejected question, its words).
- `long-text-render.property.test.ts` - generated bodies of loose Markdown
  and HTML characters plus whole links (an https target and bad ones:
  `javascript:`, `data:`, `blob:`, `http:`, credentials, relative) and whole
  picture lines (the tour's assets, a missing one, bad targets), with the
  pictures filled as the sheet does: only allowlisted elements and
  attributes; every `a` exactly its four attributes and an `https:` href
  without credentials; every `img` src an object URL made from one of the
  tour's files, one per picture of a tour asset. A second test keeps the
  generator honest: at seed 42, 2 000 bodies, about 33 % render a link
  and 31 % a tour picture (floor 20 %).
