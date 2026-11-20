# host-picker.ts

## Purpose

The host tiles of the setup's "new tour, share now" answer (polish round M2,
A6/A7; since the start question of round 2 they sit in step 2,
`start-question.ts`): one toggle tile per host from `tour-host.ts`, the
chosen host's own steps listed below them, and the starter zip shown only
for a host that needs a file before it gives a link and only while the zip
to upload is not one this phone already saved at Done. The link field
follows in the same step, so there is no Continue. Plans:
`GpsPlusSlamJs_Docs/docs/2026-10-11-0049-tour-viewer-polish-round-plan.md`
(§2a M2), and the round-2 setup flow (`start-question.ts.md`).

## Public API

- `wireHostPicker<T>({ dom, store, createElement, saved? }): HostPicker`
  - `dom.tiles` - the `role="group"` the tiles are rendered into. A
    second tap on the chosen tile deselects it and clears the stored choice
    (prototype verdict P6).
  - `dom.steps` - the `<ol>` for the chosen host's steps; hidden until a
    choice.
  - `dom.starter` - the starter zip button. Only its visibility is this
    module's; its click (pack and hand over the zip) is the wizard's.
  - `saved()` - whether the zip to upload is the one this phone saved at
    Done (the share-later route): the steps then start from it
    (`hostSteps(host, { saved: true })`) and the starter stays hidden.
    Read on each render.
  - Returns `{ render }`: draws again after `saved` changed.
  - `store` - the `localStorage` slice (`tour-host.ts`), or undefined.
  - `createElement` - `document.createElement`, injected so the tests run in
    node; `T` is the element type it returns.

## Invariants & assumptions

- Each tile is a toggle `<button>` carrying `data-host` and `aria-pressed`;
  exactly one is pressed once a host is chosen, none before. Not radios
  (PR #585 review): a second tap lets the choice go, which a radio cannot
  do, and a radiogroup promises arrow keys and one tab stop.
- The chosen tile's look keys on `aria-pressed` in `index.html`, at the
  pill rule's specificity - below it the chosen host looked like the others
  on the creator page from M2b until r821; `setup-flow.spec.js` checks the
  computed background changes.
- Each step is an `<li>` of `<span>` text runs and, where `hostStepParts`
  links the host's name, an `<a target="_blank" rel="noopener">` (r820
  feedback R2).
- A stored choice is read once at wiring and shown checked, with its steps:
  a returning creator sees what they picked.
- The choice is held in the module as well as in the store, so a store that
  throws (site data blocked) still carries the choice for the page.
- Tiles use the atoms `btn btn--prose`; the pressed look of the checked tile
  is page CSS in `index.html` (`.host-tile[aria-checked="true"]`).

## Examples

```ts
wireHostPicker<HTMLButtonElement | HTMLLIElement>({
  dom: { tiles, steps, starter },
  store: localStorage,
  createElement: (tag) => document.createElement(tag),
  saved: () => start.panel() === "share",
});
```

## Tests

- `host-picker.test.ts` - order and labels, nothing checked on a first visit,
  a tap stores and checks one tile and lists its steps, the starter zip for a
  cloud host and not an own server, a stored choice back after a reload,
  the saved zip's steps with no starter, and missing or throwing stores.
- `playwright-tests/setup-flow.spec.js` - the first visit end to end
  (storage cleared), the reload, and the own server's headers.
