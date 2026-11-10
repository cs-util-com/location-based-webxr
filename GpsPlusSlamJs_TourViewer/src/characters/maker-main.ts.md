# maker-main.ts

**Purpose:** the wiring of `characters.html`: the library view and the six steps that make a character, built from the prototype `public/prototypes/character-library-1/maker.html`. The rules live in the modules it imports; this file connects them to the page.

## What it does

- **Library view:** lists the characters on this device (thumbnail, state, age) with Rename, Save as file (shared on a phone when the browser can, else downloaded) and Delete in an inline slot; the unfinished draft with Continue and Discard (with Undo); a line for interrupted saves with "Tidy up now"; "Import character..." with its refusals in words and a name question when the file carries none ("Waiting for a name..." on the button; leaving the library view settles it). The previews' animations are kept by canvas id (`createAnimSet`), so a re-cut replaces the talk-style ones. Reads the library again when the page becomes visible.
- **Shared with the editor:** the import flow (refusal card, name question) is `character-import.ts`, and the thumbnail crop and the age line are `character-thumb.ts`; the editor's Characters list uses both.
- **Steps:** describe; copy the prompt (when the browser refuses the clipboard, the text is selected for the author); make the picture; bring it back (file, paste button, page paste, drop); check (backdrops, "As drawn" preselected and "Steady body" one tap away, "Adjust the cut" folded, its sliders cutting again 220 ms after the last change); name and save; "Make another".
- **Cut:** in a module Worker through `createCutClient`; the phases show as they run; a newer request replaces an older one, whose `AbortError` is ignored.
- **Save:** the chosen frames composed into the sheet and the first pose as `image.png`, through the library, which writes `character.json` last.
- **Draft:** kept in `localStorage` (`characters:maker-draft`) and read back through `draftOf`. The picture is not kept, so after a reload at the check or save step the page goes back to step 4 and asks for it again.
- `?in=editor` hides the "Tour editor" link and changes the lead; `?start=new` opens the steps.

## Async feedback

Every import, cut, copy, paste, save, rename, delete, tidy and file action shows an in-progress state (`busy`, or the cut phases) and ends in a toast or a visible final state; a failure goes to an error toast and the control comes back.

## Tests

`playwright-tests/character-maker.spec.js` (the whole flow, the reload, the exchange file both ways, a cut failure, a JPEG refusal, a failed save, the layout at three viewports). The modules it uses have their own unit tests.
