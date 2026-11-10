# characters.html

**Purpose:** the character maker page: the library of guide characters on this device and the six steps that make one from a picture an image AI drew. Its own Vite entry (`vite.config.ts`); the script is `src/characters/maker-main.ts` and the styles `src/characters/maker.css`. The page does not load the app's design system: it keeps the prototype's look.

## Markup contract

- `body[data-view]` is `home` or `steps`; `.home-only` and `.steps-only` follow it, and every step panel is hidden in the library view.
- The step panels are `section[data-panel="0"]` to `"5"`, each with a `[data-greet]` slot; `#rail`, `#where`, `#body` and `.actions` are the stepper, the step line, the scrolling body and the Back / Next bar.
- `#toasts` holds the toasts and `#undoBox` the Undo offers; `#picFile` and `#impFile` are the hidden file inputs.

## Built from

`public/prototypes/character-library-1/maker.html`, checked side by side at a phone, a phone held sideways and a desktop. The prototype-only parts (a made-up image AI, sample files, prepared import files) are left out.

## Tests

`playwright-tests/character-maker.spec.js`.
