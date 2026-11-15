# The place answers (quiz player, direction B)

A throwaway, standalone page. It shows a quiz step of a station's story, played in the place. It is not wired to any app.

## The direction

- The answers are hidden at the things they are about: the fountain, the statue, the plane tree and the bench. From afar each one glints now and then. Walk close and it opens like an egg, with its name and clue above it.
- When all four are found, a ring wakes on the ground at each one. Standing in a ring fills it in about 3 s, and stepping out drains it. When the ring is full, that thing is your answer for now.
- You give the answer at the question stone in the middle of the station by standing in the stone's own ring for 2 s, or by tapping the stone. Until then, standing at another ring changes the pick, and Take back clears it.
- The result is shown in the world: the ring turns green or red, the stone's sign changes, and +10 rises from the stone. The guide says why in a toast that fades. Then the story's next line takes the foot of the screen.
- **On the screen** there is one pill of dots, one per answer. Each dot is hollow until its answer is found, filled once it is, and ringed when it is picked. The question lives on the stone. The pill has no text.
- **The floor.** Tapping the pill or the stone opens one sheet. From it you can answer without walking, show an answer you have not found, take back, give, or skip.
  - A visitor who does not move: after 20 s without progress the glints quicken and can be tapped from where you stand. Choosing then works by tapping a thing twice.
  - With a rough position: no ring counts. The rings turn grey and dashed, the pill shows a hand, and things are chosen by tapping them twice. No distance is shown anywhere.
- **Leaving with the question open.** A toast says once that the question waits. The pill shrinks to a "?", the radar marks the station with "?", and the next station's light comes on. Coming back restores everything as it was.
- **The other items meanwhile.** A playing narration or film pauses and dims while the question is open. Nothing is locked: a tap plays it again, and the quiz waits.
- **Answer types.**
  - Single and multiple are answered in the world. With multiple, each ring toggles its answer.
  - Text is found in the world: the word carved over the hall's door lights up once it is looked at. It is typed in a one-line card.
  - Code and number go to the same card. They are not demonstrated.
  - Typed answers are judged only by the format's normalisation: NFC; case and spaces folded; umlaut variants, where ä, ö, ü and ß also match ae, oe, ue and ss; a decimal comma for numbers. Then the salted SHA-256 is compared.

## Ranking rule (what wins the screen)

1. A story line on screen wins. It gets one strip at the foot, and nothing else of the quiz shows.
2. While the question is open, the pill is the quiz's only screen element. Everything else the quiz says lives in the world.
3. A reaction from the guide shows once as a toast at the top, then fades.
4. At most one panel shows at a time: the sheet, or the type card. Either one replaces the pill, so the two never stack.
5. Free items show only in the world while the question is open. They dim, and a playing one pauses.

A seventh or an eighth item changes nothing on the screen; it dims in the world like the others. A second quiz in the same station keeps its stone dark until the story reaches it.

## The strongest case against it

- **It is slow and asks for a lot of walking.** Find four, stand at one, then walk back to the stone. On a crowded square, or with a child on one hand, that is a chore, and the sheet that rescues such a visitor also skips the idea.
- **It needs a good position.** It rests on answers standing at least about 5 m apart and on a position good enough to tell them apart. When the position is rough, the rings switch off and the quiz becomes a tap game in 3D, which is only play while people hold a phone.
- **A question on a stone is easy to lose.** A visitor who walks away from it relies on a small pill and the radar to remember that a question waits.
- **The quiz still takes over the station.** Pausing the other items is a ranking decision the quiz makes on its own. No rule above it decides this yet.

## Settings to sweep (in the notes, behind the menu button)

- seconds standing to choose: 2, 3 or 5;
- ring radius: 1.5, 2 or 2.5 m;
- the extra distance needed to leave a ring: 0.3, 0.6 or 1.2 m;
- when a pick counts: given at the stone, after 6 s by itself, or at once (at once allows no take back);
- tapping from afar: after 20 s idle, always, or only with a rough position;
- the idle time before the hint: 10, 20 or 40 s;
- the other items: dim and pause, dim only, or unchanged;
- tracking wander: 0.1 to 2 m;
- what happens after a wrong answer: try again, or show the right one;
- the camera backdrop: bright day or dusk.

"Measure every beat" runs all beats in the current orientation. For each beat it lists the HUD footprint, the element count and the overlapping pairs. The readout in the demo bar shows the same numbers live. Any two HUD boxes that overlap get a red outline. The demo bar is never counted.

## Beats

1. a story plays;
2. the question enters;
3. the search;
4. all four found;
5. answer by standing;
6. take back;
7. answer again;
8. give it at the stone;
9. the result;
10. the story goes on;
11. leaving with the question open;
12. coming back;
13. a weak position;
14. a visitor who does not move;
15. text answer: look for it;
16. text answer: type it;
17. two answers (multiple).

Open with `?beat=N` to start at a beat.

## Left out

- **The look of the dwell.** The rings are a neutral stand-in. The ground ring, the charging object and the light pillar from the earlier dwell prototypes can be dropped in for it.
- **Placing the answers.** The page assumes the tour format can store a place for each answer (`at` per option). That format change is not decided.
- **Sound.** There are only short synthesised tones; there is no real narration audio.
