# Calm HUD 5.1 - Scroll box (throwaway prototype)

## Purpose

The calm AR HUD's narration box as one chosen design, built so it can be judged on the phone: **one box at the bottom edge holds the words, and moving the words is moving the narration.**

- The box sits at the bottom edge, centred, in the design system's surface (the dark blue-grey gradient, the light edge, the raised shadow), less rounded than a panel (12 px) and a little see-through (72 % by default).
- It grows with its text up to 80 % of the screen width, never the full width, and at most 720 px on a large screen.
- At most three lines are visible, left-aligned. The line being said sits in the middle row; the words scroll up as the narration goes on.
- A vertical drag on the words scrolls them, and scrolling is scrubbing: drag down to hear a sentence again, up to skip ahead. One line height of drag is one line of text. A thin scrollbar on the right shows where you are; there is no progress bar, no play button and no sideways scrub.
- A tap anywhere on the box pauses or plays. A play or pause sign appears where the finger touched and fades out. After the end, a tap plays the step again from the start.
- Unread words are grey, and turn white as they are spoken, with a soft fade that starts a moment after the word.
- Above the words, the speaker: a small dot in the character's compass colour, then the name in bold white. The dot breathes softly while she speaks.
- A story step in the same box: when Greta has finished, "Next" appears in the box's right slot; the question then comes in the same box, with its two answers in a row under the words. The answer is marked with a check or a cross as well as by colour; the reply follows, then "Done" fades the box out.
- The rest of the HUD is quiet, as in round 4: Exit at the top left, the compass band at the top with the next station (orange ring), a few items (white dots) and, while Greta speaks, a notch in her colour.

Self-contained page; three.js from a CDN by import map; not wired to the app, linked from nothing in it.

## What to look at

Open it on the phone, tap the card at the bottom, and listen.

1. Let Greta speak a few sentences; watch the white move through the grey words and the lines move up.
2. Tap the box: the pause sign shows at your finger and the voice stops. Tap again: it goes on from the word it stopped at.
3. Drag the words down a line or two: the voice stops while you drag, the white goes back with your finger, and on release Greta repeats from that word. Drag up to skip ahead.
4. Let her finish: "Next" appears on the right. Tap it, answer the question.
5. Turn the phone sideways, and open the page on a desktop: the box should stay at the bottom, never span the full width, and still show at most three lines.

Things to judge: whether three lines are enough to follow; whether the grey and the white are far enough apart in sun; whether a drag on the words is found without being told; whether the box stays out of the way of what Greta points at.

The buttons in the strip at the top (1 Story, 2 End, 3 Quiz, Voice, the menu) are this page's demo controls, not part of the design; they sit at the top so the bottom edge belongs to the box.

## Starting by tap is a demo shortcut

On this page a tap on the card starts the narration. **In the app the narration plays only inside the station's radius**; the tap stands in for walking into it.

## Tester settings

In the menu (on a desktop beside the phone), or by URL: `?fs=16&tint=0.72&grey=0.55&maxw=80&voice=on`.

- Text size 14 / 16 / 18 px (line height 1.375 times that).
- Box tint 60 / 72 / 84 %: how much of the box's surface colour covers the camera.
- Unread grey 45 / 55 / 65 %: how white the unread words are.
- Widest box 70 / 80 / 90 % of the screen width.
- Voice on or off. Off plays the words on invented times without sound.
- `?measure` shows the box's size, its share of the width, the text width and the line count.
- `?autostart` starts the story without the card (for screenshots).

## Single-value choices, and the value that would change them

- **Three rows, the spoken line in the middle.** The middle row leaves one line of what was just said above it. With the spoken line in the top row the box would show more of what is coming, but a sentence heard a moment ago would scroll out of sight at once.
- **80 % width, capped at 720 px.** The cap is mine: on a desktop or a tablet in landscape 80 % would give lines of over 100 characters, which are hard to follow. If the box should fill 80 % everywhere, the cap goes.
- **72 % tint, 55 % unread grey.** Chosen so that the unread words are clearly readable but clearly not white on the box's surface. On a bright day in the field, 84 % tint is the next value to try; if the grey is mistaken for already-heard text, 45 %.
- **The fade to white: 0.55 s, starting 0.12 s after the word.** A shorter fade looks like a ticker; a longer one leaves the white a full word behind the voice.
- **One line height of drag is one line of text.** The text stays under the finger. At the first and last line a drag keeps scrubbing while the words stretch only a third as far (a rubber band), so the beginning and the end can be reached without the box running empty.
- **Tap slop 8 px.** A finger that moves less than 8 px is a tap; more is a drag. Below about 6 px taps on a moving phone turn into small scrubs; above about 12 px a short drag back is read as a pause.
- **The box sits 18 px above the bottom edge plus the system's inset**, clear of Android's home gesture bar; at 80 % width it never touches the side edges where Android's back gesture starts.

## Deviations from the brief, and why

- **Labels in English** ("Next", "Done"), not "Weiter": the gallery's other pages and the story are in English.
- **The width cap of 720 px** (above).
- **No accent strip on the box's right edge.** The design system marks a plate with an orange strip on its right edge; here the scrollbar sits there, and two marks on one edge read as clutter. The orange is on "Next" instead.
- **The speaker's dot breathes while she speaks.** Not asked for; it tells whether the voice is running when the words are paused between sentences. Easy to drop.
- **The left slot stays empty.** The brief allows the side slots or the box's bottom for a story step; "Next" took the right slot (where the thumb is), the answers the bottom, so nothing needed the left.
- **The demo strip and the compass are at the top**, because the box owns the bottom edge.

## Faked

- The voice is the browser's own text-to-speech (an English voice, a local one where there is one), one sentence at a time. Where the browser reports each spoken word, the white follows it; where it does not, the white follows times invented from the letters (about 150 words a minute, pauses after punctuation) and waits at the end of each sentence until the voice has finished it. A voice that has not started after 1.5 s is skipped for that sentence; after two such sentences the page plays on invented times without sound.
- The camera, the square, Greta and the stations are simulated; nothing runs in AR. A sideways drag on the view turns it, so the compass can be seen moving.

## Unverified

- Readability of the grey and the white in real sun on a real phone.
- Whether Android Chrome's voices report word boundaries on the test phone; if not, the white follows the invented times and can run a little ahead of or behind the voice within a sentence.
- Frame time on a real phone. The box changes a word's colour only when the word changes, but writes the scroll position and the scrollbar every frame; it measures the lines only after a resize, a setting change or a new step.
