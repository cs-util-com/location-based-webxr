# maker-draft.ts

**Purpose:** the maker's unfinished work as plain data (step, description, choices, cut settings, name), its validation when read back from storage, and what the stepper and the Next button show for it.

## Public API

- `MAKER_STEPS` (six labels). `BackdropId` and `isBackdropId(v)` (whether `v` is one of the four backdrops); `TalkChoice` (`drawn` or `steady`).
- `CutChoice`, `CUT_CHOICE_DEFAULTS` (from `CUT_SETTINGS`), `CUT_SLIDERS` (min, max and step of each slider), `cutChoiceOf(input: unknown)` (field by field; a value outside its slider's range takes its default), `cutSettingsFor(choice)`.
- `MakerDraft`, `freshDraft()`, `draftOf(input: unknown)` (field by field; a bad field takes its fresh value, a description over `DESC_MAX` too), `hasDraft(d)`.
- `DESC_MAX` (2000): the longest description a draft keeps; the slice cuts a longer one and the page's box has the same `maxlength`.
- `TEXT_MAX` (200): the longest name, saved id, saved name and failure a draft keeps; the slice cuts a longer name, saved id and saved name the same way.
- `stepInfo(d, i, hasCut)`: `{ state, sub }` for step `i` of the stepper.
- `reachable(d, i, hasCut)`: whether a tap on step `i` may go there.
- `nextLabel(d, hasCut, cutting)`: `{ label, disabled }` of the Next button.

## Invariants

- A stored record must be a JSON object that is no array: the guard is the
  framework's shared `isJsonObject` (`utils/json-guards`, deep-imported),
  not a local copy.
- `draftOf` never throws; a step beyond what the stored work allows is pulled back.
- The cut picture is never part of the draft (too big for storage); the page asks for it again after a reload.

## Tests

`maker-draft.test.ts`; the reducers that change a draft are in `maker-slice.ts`, with its own tests.
