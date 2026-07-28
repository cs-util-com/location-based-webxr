# `escape-html.ts`

## Purpose

Escapes text before it reaches an HTML sink — in practice, Leaflet's
`bindTooltip`, which renders its argument as HTML.

## Public API

- `escapeHtml(value: string): string` — replaces `& < > " '` with their
  entities. Total; never throws.

## Invariants & assumptions

- **The inputs are untrusted.** Category names come from `discoverCategories`,
  which reads the column headers of a **publicly editable Google Sheet** and
  accepts any name up to `MAX_CATEGORY_NAME_LENGTH` (20) with no character-set
  restriction. `<svg onload=x>` is 14 characters, so the length cap is not a
  mitigation — a test asserts exactly that.
  - `rule-table-loader.ts` already calls that sheet "the only thing standing
    between a bad edit to a publicly-editable Google Sheet and every downstream
    app's behaviour", so this closes an inconsistency rather than inventing a
    threat model.
- **Escaped at the sink, not restricted at the source.** Limiting category names
  to `[A-Za-z0-9_]` in `discoverCategories` was the alternative and is not taken:
  it silently drops legitimate owner-authored names (spaces, umlauts) for every
  consumer, to fix a problem that belongs to the sink.
- **`&` is escaped in the same pass, so entities double-escape.** `&amp;` becomes
  `&amp;amp;`. Displaying a stray `&amp;` is a cosmetic bug; letting an input
  `&lt;` survive as a literal `<` is a hole.
- **A plain string transform, not `textContent` on a detached node** — this
  module is unit-tested in Node, where there is no DOM.

## Examples

```ts
.bindTooltip(`<strong>${escapeHtml(category)} = ${round(score)}</strong>`)
```

## Tests

`escape-html.test.ts` — the in-budget `<svg onload=x>` payload, all five
characters, an attribute-context break-out via quotes, double-escaping of an
existing entity, and ordinary names (including one with an umlaut) passing
through untouched.
