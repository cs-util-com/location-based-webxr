# characters-panel.ts

## Purpose

The tour editor's Characters list (File, "Characters…") and the character
maker shown over the editor. It lists the characters in the open tour and
the ones the character maker keeps on this device. From it you can add a
device character to the tour (both pictures are copied in), remove one
(with an Undo), open the maker on a new character, and import a character
file. The add menu's "Character" goes through `makeForTour`.

The page look follows the chosen prototype
`public/prototypes/character-library-1/index.html`. Its stylesheet is
`characters-panel.css`, scoped to the two dialogs.

## Public API

- `createCharactersPanel(deps): CharactersPanel`
  - `deps.dom`: the elements of `edit.html`'s two dialogs
    (`#characters-panel`, `#characters-maker`), listed in
    `CharactersPanelDom`.
  - `deps.tour()`: the open tour (`CharactersPanelTour`: `characters`,
    `declare`, `remove`, `restore`, `image`, `title`), or null when no tour
    is open. The editor's adapter wraps the editor session and tells the
    autosave about each change.
  - `deps.library()`: the on-device library (`createCharacterLibrary` over
    `opfsLibraryStore`).
  - `deps.makerUrl`: the maker page. It opens as `?in=editor`, with
    `&start=new` added for "Make a character" and for the add menu.
  - `deps.say(text)`: the page's toast, used while the list is closed.
  - `deps.seen`: which library ids the editor has shown before. Defaults to
    `localSeenStore()` with key `characters:seen-in-editor`.
  - `deps.now`: the clock, for the "looked ..., HH:MM" line.
  - `deps.makerShown(shown)` (optional): told true when the maker's dialog
    opens and false when it closes; the editor stops drawing its 3D view
    meanwhile, so the cut and the save get the machine.
- `CharactersPanel`
  - `open()`: shows the list and reads the library.
  - `isOpen()`: whether the list shows. `dialogOpen()`: whether the list or
    the maker shows; the editor keeps its keys out of both.
  - `makeForTour(hooks?)`: opens the maker on a new character;
    `hooks.hold(text)` is called once the maker has closed, before the new
    character is looked for and added, with "Adding the character to the
    tour..."; the page shows it and returns what takes it down, which
    `makeForTour` calls once the add settled, whatever the outcome (made,
    none saved, refused, or a failure after the close, which is said:
    "The character was not added: ..." and returns null). When the maker
    closes, the newest character saved in the meantime is declared in the
    tour and returned. It returns null in three cases:
    - none was saved ("No new character was saved, so nothing was added");
    - the library cannot be read ("The characters on this device could not
      be read: ...");
    - the tour refuses the character (his name and the reason are said).
- Inside the module: `localSeenStore` (the default `seen`, key `characters:seen-in-editor`) and the `RelistReason` of the status line.

## Behaviour

- The list reads the library at three moments: when the list opens, when
  the maker's dialog closes, and when the tab comes back to the front while
  the list shows and the maker does not (the maker may have run in another
  tab). The status line names the moment, with the time.
- The tour gives each character its own id; the library id (which tells
  when he was made) never reaches the tour. A library character counts as
  in the tour when the tour declares his four poses: the list learns each
  one's poses as the tour names them (`tour.fileId`, once per character)
  when it reads the library.
- A "new" character is a library id not seen before and not in the tour. On
  the very first read (no seen ids kept yet), every character counts as
  seen.
  - New ones are marked "New" and offered in the banner: "New on this
    device: A and B.", then "Add X to the tour" (or "Add all N to the tour")
    and "Not now".
  - A maker close that brought nothing new says "Nothing new on this
    device".
- "Add to tour" shows "Adding..." while the two pictures are copied in. It
  ends with one of:
  - "X is in this tour now";
  - "X was not added: <reason>";
  - "Adding did not work: <reason>. Try again."
- Remove takes the character out of the tour. It is refused, with the
  reason, while an item still names him. On success it offers Undo, which
  declares him again as he was.
- "Import character..." runs in three steps:
  - "Reading the file...": the shared flow of
    `../characters/character-import.ts`, with its refusal card;
  - "Waiting for a name..." while its name question stands; closing the
    list (or opening it again) settles the question with nothing, so
    Import is never left disabled;
  - "Importing...": the character is saved to the library, marked seen and
    declared in the tour;
  - "Imported X: it is in this tour, and kept on this device".
- The list has its own toasts and Undo inside the dialog, because the
  page's toasts would sit under a modal dialog.
- The maker's dialog closes with "‹ Back to the tour", or with Escape,
  outside the frame or inside it (a key pressed in the maker reaches the
  frame's own document, so the panel listens there on each load; an
  Escape the maker used itself, `defaultPrevented`, is left alone).
  Closing empties the frame, so the maker stops running.

## Invariants and assumptions

- Every name is escaped where it is drawn.
- Two library reads never overlap: a read asked for while one is running
  waits for it.
- A list that finishes drawing late (thumbnails still loading) never
  replaces a newer one.
- Adding copies the pictures into the tour, so the tour keeps the character
  even if he is later deleted from this device.

## Example

```ts
const characters = createCharactersPanel({
  dom,
  tour: () => (editor ? charactersTour(editor) : null),
  library: characterLibraryNow,
  makerUrl: "./characters.html",
  say: toast,
});
fileCharactersButton.addEventListener("click", () => characters.open());
const made = await characters.makeForTour(); // TourCharacter | null
```

## Tests

- `characters-panel.test.ts` (jsdom, with a library and a tour in memory)
  covers:
  - the first read and the banner;
  - add: busy state, success, refusal and failure; "add all"; "not now";
  - remove and its Undo, and a refused remove;
  - the maker: its URL, closing it, and the "nothing new" line;
  - the maker over the editor: `makerShown` on open and close, `hold`
    from the close until the add settled (taken down after a success,
    after nothing saved and after a failure after the close, which is
    said), Escape inside the frame;
  - coming back to the tab;
  - `makeForTour`: made, none saved, refused, library unreadable;
  - import: the busy steps, a refusal, a failed save, a cancelled name
    question;
  - the page toast while the list is closed.
- `playwright-tests/editor-characters.spec.js` runs the whole path in a
  browser (maker -> library -> editor -> placed character -> reload) and
  checks the list's layout at three viewports.
