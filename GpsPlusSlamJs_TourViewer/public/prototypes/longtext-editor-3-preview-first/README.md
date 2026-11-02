# Long text editor 3: preview first, edit what you see

A throwaway UX prototype for the LONG TEXT block in the desktop tour editor.
It is one of three directions. This page is self-contained: no libraries, no
build step, and nothing is saved. The 3D view is a CSS 3D picture used only for
context. The strip at the very bottom ("Prototype controls") is the prototype's
own control panel and is not part of the design.

## The direction in two sentences

The creator works on the visitor's own view. The 3D view flies to the station
and shows the reading sign, and a click on the sign opens the reading sheet
exactly as the visitor will see it. The creator then writes directly in that
sheet, with a small formatting bar above it, while the inspector only
summarises and lists what needs attention.

## What it optimises for

- **Creators who never want to see Markdown.**
  - Bold, italic, headings, lists, links and pictures come from a toolbar and
    the usual shortcuts.
  - The stored body is still Markdown. A "Markdown" switch shows the source
    for those who want it.
- **Confidence that what you write is what the visitor gets.**
  - There is no separate preview to compare against: the writing surface is
    the visitor's sheet, with its fonts, sizes, width and footer.
  - Creator-only information sits in strips labelled "Only you see this", or
    as soft marks that "Visitor's eyes" hides.

## What it gives up

- **The writing column is phone width (about 400 px).** That is right for
  checking what visitors see, but cramped for drafting a long essay. There is
  no side-by-side source and preview, and no full-screen writing mode.
- **A rich-text editor sitting on Markdown is the hardest thing in this
  direction to build well.** Caret handling, paste, undo and IME composition
  all need care. The prototype covers the common paths only.
- **The 3D view shrinks to a strip while the sheet is open** (on a 1024 px
  screen it is about 260 px wide).
- **The creator mostly sees the reading view.** Captions and "On screen only"
  need a switch to look at.
- **The read-along marks depend on the browser's CSS highlights.** They are
  not available in every engine; the page says so when they are missing.

## Answers to the five questions

1. **Writing the body.**
   - The creator writes in the reading sheet itself, opened from the sign in
     the 3D view (or with "Open the text to write in it" in the inspector).
     The title is edited in the sheet's heading too.
   - The formatting bar has bold, italic, heading, list, numbered list, link,
     and a picture from the tour's files. Tab and Shift+Tab nest list items.
     Undo and redo cover every edit, including fixes.
   - The preview *is* the writing surface. "Visitor's eyes" hides every creator
     mark, so the creator sees the exact visitor view.
2. **"Shown as typed".**
   - These parts appear in the sheet as their literal characters, exactly as
     visitors will see them, with a soft blue highlight and a dashed underline.
   - Tapping one (or using "Show" in the inspector, which works from the
     keyboard) explains in plain words why it is shown that way.
   - Each part offers a one-click fix. For example:
     - a table becomes a list, or plain lines;
     - HTML keeps the words and drops the code;
     - a footnote moves into the sentence in brackets.
   - "Keep it as typed" leaves the part as it is: it stays listed, marked as
     kept, so nothing disappears.
   - The inspector shows a count badge and a list with a location for each
     part ("after ...", or a line number in Markdown mode). Nothing blocks
     saving or scolds the creator.
3. **The view picker.**
   - A "See it as" switch sits on the preview: Sign and sheet, On screen only,
     or Captions. Each option shows a one-line description of what visitors
     get, and the 3D view switches with it:
     - Sign and sheet shows the sign;
     - On screen only shows an empty spot and the sheet open on arrival;
     - Captions shows the sound marker and the caption strip.
   - Captions without a voice that lines up can still be chosen. The preview
     then shows what visitors actually get (Sign and sheet), says why, and
     offers the next step: "Add a voice", "Add the timing", or "Line the voice
     up again".
4. **Adding a narration.**
   - "Add a voice" opens a three-step guided flow in the inspector.
     1. The voice: drop or choose a recording, or use the sample. Choose who
        speaks (a person or a speech program) and write the credit line.
     2. Its timing: subtitles (.vtt) or a word list (.json), each with a sample
        button, or "I have no timing yet".
     3. The check: "18 of 19 sentences line up", then "2 lines of the file did
        not match your text - here they are".
   - Every line that did not match is listed with its time, what the voice
     says, and why. Where it is close to a sentence it offers "Use it for that
     sentence". It also offers "Leave it out" (still listed under "Left out on
     purpose") and "Listen". Sentences with no line in the file are listed too.
   - "Listen through" plays the read-along in the sheet on a fake clock, with
     no audio. A "Listening through" strip with moving sound bars runs above
     the sheet, and the sign's seal animates as well.
   - When the voice says a line that is not in the text, the strip says so
     while it plays.
   - Cancel puts the voice back as it was. No step ever edits the body.
5. **A stale timing.**
   - After an edit, the changed sentences are greyed in the sheet (dotted
     underline). An "Only you see this" banner says: "The voice no longer
     lines up with 1 sentence ... visitors hear the voice but no words light
     up". It offers "Line the voice up again".
   - While listening, the voice's position on a changed sentence shows as a
     grey band instead of the amber read-along. Tapping a greyed sentence
     explains it and offers the same button.
   - Lining up again reports what happened: "Your text was not changed. 24 of
     25 sentences have the voice again (1 after small word changes). 1
     sentence could not be matched ... 1 part of the recording no longer has a
     sentence; it is listed under Voice".
   - The report offers "Show it in the text", "Listen through" and "Put the
     old timing back".

## Assumptions made

- **"On screen only" plays no voice.** It follows the visitor page's "Sound
  off" view, which is for museums and quiet places.
- **A "shown as typed" block keeps its line breaks** (for example, a table's
  rows), because that is how the characters are typed.
- **Pasting is handled in two ways.** Pasted plain text is read as Markdown,
  so a pasted `<p>` or `| a | b |` lands in the "shown as typed" list.
  Characters the creator *types* are stored escaped, so typing `*` never turns
  into formatting by surprise. Pasted formatted text (HTML from a word
  processor or a web page) keeps the formatting the sheet can show; a table in
  it becomes a typed table.
- **Lining the voice up again keeps a changed sentence's part of the
  recording** when at least half of its words still match, in order. This
  threshold is a guess from one sample: a typo fix scores about 0.9, and the
  sample rewrite scores under 0.3. A real build should sweep it over real
  edits.
- **The sample subtitle file has two mismatches.** It reads "1612" aloud as
  "sixteen twelve", and it says one line that is not in the text. Real `.vtt`
  files are parsed. Real `.json` word lists are not: use the sample.

## Debug strip

The strip at the bottom has these buttons:

- Paste a table, and Paste HTML;
- Import a WebVTT with 2 mismatches;
- Import a word list that fits;
- Edit a word (the timing goes stale), which adds the sample voice first if
  there is none;
- Re-anchor (1 sentence cannot be matched), which rewrites one sentence and
  lines the voice up again;
- Play / pause, and Reset.

The page has no `<input type="range">`.
