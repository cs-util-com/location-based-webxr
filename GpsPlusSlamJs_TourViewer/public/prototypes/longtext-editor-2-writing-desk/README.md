# Long text editor 2: a writing desk

**Direction.** Selecting a long text and pressing **Write** turns the 3D view's area into a writing desk. The text sits on the left, with what is "shown as typed" listed in a margin beside its lines. A phone with the visitor's view stands at full height on the right and scrolls along with the text. Under the text, a narration strip lays the voice's timing along the text's sentences. The left rail stays, so the creator can switch blocks without leaving the desk.

Open `index.html` directly, or with `#desk` to start inside the desk. The strip at the bottom with the dashed magenta border is the prototype's own debug control, not part of the design. The 3D view is a static drawing. The voice is a fake clock, so there is no sound; the equaliser icon and "Voice playing (simulated, no sound)" show when it plays. Nothing is saved.

## What it optimises for

- **Long essays.** The body is a 2,000-word, 12-minute essay with headings, a nested list and a picture.
  - Writing happens on a large surface with the line length of a document.
  - A gutter shows line numbers and marks.
  - Every list in the desk is anchored to the creator's own lines: the margin entries sit beside their line, and gutter dots mark where the voice disagrees.
- **Seeing exactly where the voice and the text disagree.** One timeline shows:
  - the voice's sound;
  - your sentences in line under it;
  - a third row, "Out of line", where a disagreeing sentence drops visibly out of its place:
    - a changed sentence: dashed amber, tied back to the gap it left;
    - a sentence with no voice: hatched rose;
    - a subtitle the text does not have: a rose flag on the voice row.

  A "Whole text" bar above it shows every disagreement across the full 12 minutes at once.
- **Never losing text.** No import, view change, re-line or "use its time" ever writes to the body. Rewrites of shown-as-typed parts go through the browser's own undo, so Ctrl+Z puts them back.

## What it gives up

- **The 3D context while writing.** The desk covers the 3D view; you go back with "3D view" or by choosing a non-text block. The sign's look is still shown on the phone and in the view cards.
- **Formatting stays visible.** You write in a plain, quiet editor, not rich text: heading marks and stars stay visible, only dimmed. A word-processor user sees `## The keep` rather than a big heading in the source. Toolbar buttons and Ctrl+B, Ctrl+I, Ctrl+K mean the marks never have to be typed, and the phone shows the result next to them.
- **Width.** The desk wants a wide screen. At 1024 px the margin list and the narration list get narrow, and long entries wrap a lot.
- **Narrow text column.** The narration strip spans the text and the margin rather than the full width, so the phone can be a real, readable phone at full height.

## The five questions

1. **Writing the body and previewing it.**
   - The inspector shows a short excerpt, the word count and a large **Write** button (also the W key).
   - Write opens the desk. Typing updates the phone within a fraction of a second.
   - The phone follows the text by scrolling both ways ("In step").
   - "My marks" outlines on the phone what is shown as typed, and puts an amber bar beside the paragraph being written.
   - A toolbar has heading (press again for a smaller one), bold, italic, list, numbered list, link, a picture from the tour's own files, and a "What becomes formatting" card.
   - Tab inside a list makes a nested list.
2. **Shown as typed.** The parts shown as typed carry a calm blue wavy underline in the text and a blue bar in the gutter. Each has an entry in the margin, level with its line. The margin is not an error list.
   - An entry says plainly what the visitor will see, for example: "Visitors would see the angle brackets, like `<p>` and `<b>`, around your words."
   - It shows the literal characters, a rendered suggestion (a table becomes a lead-in line plus a list; web page code becomes plain words with bold kept), and two choices: "Use the ..." or "Keep as typed".
   - Kept entries stay listed in grey with "Show the suggestion again".
   - Entries outside the visible part are counted ("2 more above"), and the arrows in the margin header step through them.
   - A paste is picked up the moment it lands.
3. **The view picker.** There are three illustrated cards, each a small drawing of the phone:
   - **Reading sign:** a sign on a stem, then the sheet.
   - **Quiet screen:** the sheet only, with a crossed-out speaker.
   - **Captions:** the camera view with a subtitle strip.

   The cards appear in the inspector with a full sentence each, and in the desk above the phone, which switches at once. Captions:
   - says "needs a narration" and refuses, with a pointer to the narration strip, when there is none;
   - says "for now: Reading" while the voice is out of line, because visitors then get the reading sign.

   A line under the phone says what the chosen view means for a visitor.
4. **Adding a narration.**
   - Without one, the strip shows two drop slots: "The voice" and "Its timing" (a subtitle file or a word list), with a note that every non-matching line will be listed. The file choosing is simulated: use the debug buttons.
   - After a WebVTT import:
     - a message says "102 of 104 lines match your text, 2 do not; they are listed, nothing was dropped";
     - each subtitle line not in the text gets a rose flag on the voice row and an entry naming its time and words, and where it sits in your text;
     - each sentence it left without a voice gets a rose block in the "Out of line" row, a rose dot in the gutter and a dotted rose underline in the text.
   - The entries offer:
     - "Play it";
     - "Use its time for that sentence", after which the subtitle entry turns green with "Done" and stays listed;
     - "Leave it", which moves the entry to a "Settled" group that is still listed.
   - A word list that fits lines up every sentence and lights words one by one.
   - Play, the arrow keys on the timeline, and clicking or dragging on either timeline all drive the phone and the text together.
5. **A stale timing.**
   - Editing a sentence the voice says turns the strip amber: "The voice no longer lines up with 2 sentences. You changed them after the voice was lined up. Until it is lined up again, visitors read the whole text without highlighting; the voice still plays."
   - The timeline jumps to the first changed sentence, which hangs dashed in the "Out of line" row below its empty place. The text shows the changed sentences with a dotted amber underline, and the phone says what visitors now get.
   - Edits that lose nothing the voice says stay lined up on their own, with a quiet note. These are formatting changes and added sentences; an added sentence is listed as "Added after the voice was made".
   - **Line the voice up again** finds each sentence by its words. The result card lists:
     - "102 sentences as they were";
     - "1 changed sentence, found by its words", with a word-level before/after;
     - "1 could not be matched", with "Give it" plus the time of the old sentence it replaced, "Play that part" or "Leave it unlit";
     - any sentence the voice says that the text no longer has.
   - "Before and after on the timeline" draws each sentence's old place as a ghost with a green arrow up to its new place. "Undo lining up" restores the earlier state.

## Notes and simplifications

- **Matching rule.** Sentences are matched by their words, ignoring formatting, case and punctuation:
  - exact matches first, in order;
  - then, inside the gaps, pairs that share at least half their words in order (the threshold is 0.5).
  - Only the threshold decides which reworded sentence is "found" and which is "could not be matched". The debug edit sits clearly on either side of it: one word changed, and one sentence rewritten entirely.
- **One subtitle per sentence.** The simulated WebVTT has one subtitle per sentence. A real file whose subtitles split or merge sentences needs the word-level matching that the word list uses here.
- **Typed parts are not spoken.** Parts shown as typed (a table, web page code) count as not spoken. So pasting them never puts the voice out of line.
- **Rendering subset.** The visitor-side rendering is a small re-implementation of the reading sheet from `station-blocks-1-narrated-text`, for the preview only.
- **No range input.** The page has no `<input type="range">`.
