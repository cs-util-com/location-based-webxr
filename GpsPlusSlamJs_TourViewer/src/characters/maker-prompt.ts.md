# maker-prompt.ts

**Purpose:** the prompt the author copies into an image AI: a fixed layout around their own description. The page sends it nowhere.

## Public API

- `PROMPT_HEAD`, `PROMPT_EMPTY` (the placeholder for an empty description), `PROMPT_BODY`, `IDEAS` (four example descriptions), `promptText(desc)`.

## Invariants

- The layout part asks for what the cut expects: four poses in one row of a 3:2 picture, feet on one line, a transparent or flat white background, no ground shadow, no text.

## Tests

`maker-prompt.test.ts`.
