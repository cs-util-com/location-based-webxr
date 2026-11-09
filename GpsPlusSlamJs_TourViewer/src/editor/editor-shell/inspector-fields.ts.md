# inspector-fields.ts

## Purpose

The item inspector's small DOM pieces: elements, typed fields, number fields, chip groups and icon buttons. They are shared by the dock (`shell-inspector.ts`) and the kinds' panels (`../kind-panels/`).

## Public API

- `el(tag, className, text?)`: an element of `tag` with the class `className` (required; `""` for none) and, given, its text.
- `fixed(value, digits)`: a number as the inspector shows it.
- `fieldId()`: a page-unique id for a field and its label or count (one counter shared by every inspector piece).
- `iconButton(icon, label, act)`: an icon button with `data-act`, its label as `aria-label` and title.
- `labelled(label, value, shown?)`: a row (`div.f`) of a `<label>` tied to `value` (given a fresh `fieldId()` here) and `shown` (the value, or a box holding it).
- `severalLines(value)`: whether `value` holds a line break.
- `typed(field, value, className)`: a one-line text input under a field name (`data-field`), which the shell commits; a value of several lines is shown, and taken as its default, on one line. No textarea is made here.
- `numberBox`, `numberField(label, field, value, unit)`, `lineField(label, field, value, placeholder)`: labelled fields.
- `chipGroup(label, act, choices, current)`: a label plus a radio-like chip row (`data-act="<act>:<value>"`, `aria-pressed`).

## Invariants & assumptions

- Pure DOM builders, with no state apart from the id counter. They were moved out of `shell-inspector.ts` unchanged, so the DOM they make is the same as before.
- They never commit a field: they only set `data-field`, and the shell's input handling writes it.

## Examples

```ts
const size = numberField("Size", "size", fixed(2.5, 2), "m");
const [label, chips] = chipGroup(
  "View",
  "view",
  [{ value: "placed", label: "Placed" }],
  "placed",
);
```

## Tests

Covered through their users: `shell-inspector.test.ts`, `../kind-panels/kind-panels.test.ts` and `editor-shell.test.ts`.
