# `default-category.ts`

## Purpose

Decides which affordance category the demo opens on, and states why it is
`battleArea`.

## Public API

- `DEFAULT_CATEGORY: "battleArea"` — the preferred opening category.
- `pickDefaultCategory(categories: readonly string[]): string` — returns
  `DEFAULT_CATEGORY` when the list contains it, else the first entry, else `""`.

No error modes: any array is valid input, including an empty one.

## Invariants & assumptions

- **The choice is guarded, not a literal.** The category list comes from the
  published rule sheet at runtime, so a table without a `battleArea` column is a
  real case — `data-and-caching.spec.js` boots one whose only column is
  `walkable`. An unguarded literal would set a `<select>` value matching no
  option, which the DOM discards, leaving the demo scoring against `""`.
- **`""` for an empty list is deliberate**: it is what an empty `<select>`
  reports, so the assignment agrees with the DOM rather than being thrown away.
- **Changing this value has an e2e blast radius.** Several specs name the
  default by value (`boot-and-shell.spec.js`, `map-and-cells.spec.js`), and any
  helper that picks "a different category" must compare against the CURRENT
  value rather than against a hard-coded `"walkable"` — otherwise it can select
  the default itself and the category-switch tests become silent no-ops instead
  of failures.

## Examples

```ts
const loaded = await worker.call("init", {});
categorySelect.value = pickDefaultCategory(loaded.categories);
```

## Tests

`default-category.test.ts` — the preferred choice, that it is found at any
position in the column order, the single-column fallback, and the empty list.
The value reaching the picker is covered end to end by
`boot-and-shell.spec.js`.
