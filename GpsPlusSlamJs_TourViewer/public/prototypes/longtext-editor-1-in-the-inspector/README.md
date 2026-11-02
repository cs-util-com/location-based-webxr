# Long text editor 1: everything stays in the inspector

**Direction.** The creator writes the long text right in the right-hand inspector, in a compact writer with a small formatting toolbar, and the 3D view and left rail keep their places. The preview is a phone-sized reading sheet that sits over the 3D view next to the inspector. The narration is a collapsible section at the bottom of the same inspector.

**Optimises for:**
- never leaving the editor's layout: there is no mode switch, no modal and no second page;
- a small laptop screen: the page works at 1440x900, 1280x720 and 1024x768;
- the phone preview fits itself between the rail and the inspector, and folds the rail when there is no room.

**Gives up:**
- writing space. The writer is a narrow column (360 px, 340 below 1100 px), about 170 px tall at 1024x768 while a note is open. The "Wider" button in the inspector header widens it to about 540 px, but long essays are still written in a column.
- a true WYSIWYG writer. The writer shows the stored Markdown with its marks dimmed, and the formatted result is in the phone preview, not in the writer itself.

Open `index.html` directly. No build step and no libraries. The voice is faked: a clock and a sound indicator stand in for audio. Real `.vtt` and `.json` files can be imported or dropped onto the Narration section, and are parsed in the page only. The striped "Prototype debug" strip at the bottom triggers the brief's cases.

## The five questions

1. **Writing the body and previewing it.**
   - The body is typed in the inspector's writer: a plain text area over a marked-up mirror. Headings show white, bold text white, italic warm, links blue, and the Markdown marks faint.
   - The toolbar has heading, subheading, bold, italic, bulleted and numbered lists, indent and outdent, link, picture from the tour's files, and help.
   - Shortcuts: Ctrl+B, Ctrl+I, Ctrl+K, and Ctrl+Shift+8 / Ctrl+Shift+7 for lists.
     - In a list, Enter continues the list and an empty item ends it.
     - Tab and Shift+Tab nest list lines; Esc, then Tab, leaves the writer.
     - Every change goes through the browser's own editing, so Ctrl+Z undoes it.
   - Markdown is never required: the buttons write it, and the stored body stays Markdown.
   - The phone preview next to the inspector updates as you type. Clicking "Show" anywhere in the inspector flashes the matching words in the preview.

2. **"Shown as typed", line by line, without scolding.**
   - These parts get a gentle dotted blue underline in the writer and are counted in a quiet chip under it ("2 parts shown as typed"): a pasted table, columns from a spreadsheet, web page code, code boxes, quote marks, dividers, footnotes, pictures from the web, and pictures that are not in this tour.
   - When the cursor is in one, a one-line callout says what the visitor will see and offers:
     - **Make it plain text**: a table becomes list lines, web page code loses its `<...>` marks but keeps its bold and italic. No words are ever removed, and Undo is in the toast and on Ctrl+Z.
     - **Use a tour picture**, for pictures only.
     - **Keep as typed**: the part then moves to a "Kept as typed, on purpose" list, from which it can be marked again.
   - Nothing blocks saving. The chip opens a list of every part with its line number, which also works from the keyboard.

3. **The view picker.** A compact segmented control at the top of the inspector (Reading sign / Screen only / Captions, a radio group with arrow keys) and a one-line description of what the visitor sees.
   - **Captions without a narration:** the option stays focusable but dimmed. Choosing it explains why it needs a narration and offers "Add a narration".
   - **A chosen Captions view that cannot show:** if the narration is removed or the voice no longer lines up, the description and a note above the phone say that visitors get the reading sign for now.
   - **Live preview:** the preview switches with the picker: the sign and sheet, the sheet on screen with a reading mark, or the caption strip.

4. **Adding a narration.** The collapsible Narration section at the bottom of the inspector holds:
   - a Voice row (add, replace or remove; a file can also be dropped here);
   - a Timing row ("Import timing...", which takes `.vtt` or `.json`, with the note "Importing never changes your text").
   - An import ends in a result card, e.g. "25 of 27 lines of the file match your text. 2 lines do not match your text; they are listed below". Each listed line shows its line number in the file, its time and its words, plus a **Listen** button that plays just that part in the preview.
   - "OK, fold this away" turns the card into a persistent "2 notes about this narration" line, so nothing that does not fit ever disappears. Sentences of the text with no voice are listed the same way, with "Show in text".
   - A play row (play, a seekable bar that works from the keyboard, the time, animated sound bars) drives the read-along in the phone preview. The phone's status bar also shows a speaker while the voice plays.

5. **A stale timing.**
   - When an edit changes what the voice reads, the Narration header turns amber ("Needs lining up: 1 sentence"), the tree item gets a dot, the changed sentence is tinted in the writer, and a note above the phone explains what visitors see now.
   - Inside Narration, a quiet notice says why, in plain words: `"The old market square...": you changed "six" to "seven"`, plus new, rewritten or removed sentences. Each comes with a **Show** button.
   - It offers **Line the voice up again**, with "Your text stays exactly as it is."
   - The result card says what was kept and what was not, e.g.: "24 of 25 sentences have their voice. The sentence you edited keeps its voice: the words around the change set the timing. 1 sentence could not be matched...". Each sentence it could not match is listed with what the voice says there instead, plus Listen and Show in text.
   - A voice part that is no longer in the text stays listed as well.

## Never happens here

- The body is never edited by an import, by lining the voice up again, or by a view change. Only the creator's own typing and the "Make it plain text" fixes change it, and those are undoable.
- File lines that do not match, sentences without a voice, and voice parts no longer used are always listed: in the result card, then under "N notes".
- No creator-facing text names internal concepts. The debug strip keeps the brief's case names on purpose.
- No control depends on hover. The callout follows the cursor in the writer, not the mouse.
