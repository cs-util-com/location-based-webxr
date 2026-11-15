# The card answers (quiz player, direction A)

A throwaway prototype. One self-contained page (`index.html`), three.js by import map, not wired to the app.

## The direction

A quiz is one more step of a station's story, so it is played in the story card, the one panel at the foot:

- the guide's portrait and the step's eyebrow ("Question - 10 points") on one row, the question as one line;
- the answers in the place where Continue stood, the only large element;
- one action row of fixed height under them, so nothing jumps: a hint and Skip, then "Lock in ..." once something is picked, then Continue after the result;
- the guide reacts in the same card: a new line, a mood on the portrait, a points pill, the running total pulsing.

The place still carries the answers when they are things in it. Each choice answer (A-D) has the same letter floating over its thing in the square, kept at one size on screen. Tapping the letter (or the thing) in the world picks that answer on the card and shows the thing's plate large for a few seconds, so a visitor who cannot walk there can still read it. A small arrow on a chip points to its thing while that thing is out of view. Choosing never depends on where the visitor stands.

## All five answer types

- **One answer** (`single`): four chips, tap to pick, tap again to take back, "Lock in A: The fountain" to count it.
- **Several answers** (`multiple`): the chips are toggles with a square marker, "Lock in 2 answers".
- **A word** (`text`): one field and Check. Judged after Unicode NFC, case and white-space folding and umlauts written out (ü = ue), against salted SHA-256 hashes. The page does not hold the word.
- **A code** (`code`): the same field in a code look (monospace, upper case shown, a length cap) and the same judging. Spelling variants ("K7M2", "K7 M2") are separate hashes the creator lists.
- **A number** (`number`): a decimal keypad, the unit inside the field, a decimal comma accepted, judged within the tolerance; the hint says how close counts.

Nothing is handed to another surface: the card is the floor every world quiz can fall back to, and it needs no format change.

## Right, wrong, and how the story goes on

- Right: the chip turns teal with a tick, the guide says why, "+10" in the line, the total pulses. Continue wakes after a short guard (0 / 450 / 900 ms to compare) so a double tap cannot skip the reaction.
- Wrong with a retry: the chip is struck through and stays disabled, the guide gives a hint, "One more try, for 5 points".
- Wrong for good: the right chip is outlined dashed (choice answers only; a typed answer is never revealed, a number is, since it is stored in clear), "No points", Continue.
- Then the guide's next line, then the walk's peek (next station) in the same slot.
- Skip is always there: no points, the story goes on.

## Ranking rule (what wins the screen)

The story card is the one panel. While a question is on it, it wins the foot of the screen; free items of the station (the narration plume, the video board) keep only their look in the world and glow, they open no card. Exit and the radar stay. A toast may show once (weak position). Leaving the station with the question open folds the card to one line ("A question is waiting ... your pick is kept"); coming back opens it again.

## The fixed demonstration

Fourteen beats per answer type, stepped with the arrows at the top (dashed: the demo's own controls, not the design): arrive, the question appears, search, answer, take it back, answer again, result, if it was wrong, the story goes on, station done, a run with a weak position, a run with a visitor who does not move, leave with it open, come back. The menu (or the side panel on a desktop) switches the answer type and the values to compare, and "Measure every beat" fills a table of footprint, element count and overlaps for both orientations.

## Measured (390 x 844 / 844 x 390)

"Measure every beat" on the page fills the table. HUD = Exit, radar, toast and the card; the keyboard is counted apart. Upright / sideways, one-answer question:

- a story line: 20.0 % / 18.9 %, 3 elements;
- the question open, searching, picking, taking back: 27.4 % / 26.0 %, 3 elements;
- the result: 27.1 % / 25.7 %; a wrong answer with its hint: 29.9 % / 28.5 %;
- weak position (with its one toast): 31.5 % / 29.1 %, 4 elements;
- the walk's peek: 13.6 % / 13.9 %; folded after leaving: 9.7 % / 10.0 %;
- zero overlaps in every beat of every answer type, in both orientations.

Typed answers: 25.7-28.2 % upright, 23.2 % sideways; while typing the keyboard adds 32 % upright and 50 % sideways (sideways the card shrinks to the question and the field).

## Strongest case against

It is a form. The place carries the answer, but the screen carries the act: a visitor can answer "which was built in 1784" from the gate without looking up once, and an open question costs about a quarter of the screen upright, the most of any quiz direction. It needs no new format and no position, which is why it is the floor, not why it is the best. A second weakness: the world letters and the chip arrows are extra machinery on top of a card that would work without them; if they read as noise on a phone, the plain card remains.
