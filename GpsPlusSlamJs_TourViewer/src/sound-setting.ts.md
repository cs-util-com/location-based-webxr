# `sound-setting.ts` - sound on or off for every tour

## Purpose

The visitor's sound setting, remembered on the device for every tour, and
what it does to the page's sounds:

- no voice starts by itself while it is off, a hand-over from a voice that
  ends or is freed included, and turning it off holds the voice that is
  playing (`silencedFocus`, over the page's voice focus, so narrated
  texts, figures, a story's sound and free narrations alike);
- back on, the voice it kept quiet carries on (the one it held, or the one
  handed the channel while off), so the channel is never left to a voice
  nobody hears;
- a free ambient sound is paused and not read while off (`world-sound.ts`
  `sound`);
- a free narration does not carry on at a return (`world-sound.ts`).

`whileShown` makes the page itself part of it: while the document is
hidden or the page is gone (`pagehide`) the sound is off the same way, and
at return (visible again, `pageshow`) it is the setting again: ambient
plays by its level, the held voice carries on.

A tap still plays a voice: it is the visitor's own ask, and it turns the
setting on (`silencedFocus`'s `turnOn`, `main.ts` `soundSetting.set(true)`,
so saved), for EVERY voice alike - a narration circle, a free sound, a
narrated text, a figure, a story's clip - so the toggle reads "Sound on"
while that voice is heard. A tap with sound already on changes nothing.

## Public API

- `SoundGate` - `on()`, `onChange(listener)` (every change, not a repeat;
  returns its unsubscribe): whether sound may be heard now.
- `SoundSetting` - a `SoundGate` with `set(on)`.
- `createSoundSetting({ storage })` - read once from the `sound` field of the
  visitor's one prefs key (`visitor-prefs.ts` `VISITOR_PREFS_KEY`); anything
  but `"off"` is on.
- `bindSoundToggle(button, setting)` - the list's sound button
  (`#walk-sound`): `aria-pressed` true while off, a label saying what a
  press does, `data-sound`; a press flips the setting. Returns its unbind.
- `whileShown(setting, doc, win)` - a `SoundGate`: `setting` and the page
  shown (`doc.visibilityState` not `"hidden"`, no `pagehide` without a
  later `pageshow`). Listens for the page's life; nothing to unbind.
- `silencedFocus(focus, gate, { turnOn? })` - `focus` with `selfStart`
  refused while off, a `tapped` while off calling `turnOn` (after the
  hand-over, with nothing kept quiet, so no other voice carries on), every voice's `carryOn` gated (a hand-over while off leaves the
  new running voice quiet), the running voice held when it goes off and
  the quiet one carried on when it comes back. Each voice reaches `focus`
  behind one gate object of its own (a `WeakMap`), so `running()` answers
  the caller's voice.

## Invariants & assumptions

- A write merges `sound` into a FRESH read of the key, never into the value
  read at the start, so a view choice another tab wrote since is kept; a
  view choice (`storeVisitorChoice`) keeps `sound` the same way.
- No storage, or one that throws or holds no JSON: the setting starts on and
  lasts the page.
- The page makes one setting, one `whileShown` over it and one
  `silencedFocus` (`main.ts`); the world sounds read the same gate.
- A tap clears the quiet voice: the tapped one runs and plays, whatever was
  quiet is held behind it by the channel's own rule and, with sound still
  off, stays quiet when the tapped one ends.
- The stored value is read through `visitor-prefs.ts` `prefsRoot`.
- Videos outside the voice focus (an item card's muted clip) are not
  touched by it.

## Examples

```ts
const setting = createSoundSetting({ storage: localStorage });
const focus = silencedFocus(createVoiceFocus(), setting);
bindSoundToggle(document.querySelector("#walk-sound")!, setting);
setting.set(false); // the running voice is held
```

## Tests

`sound-setting.test.ts`: the default, the remembered off beside the views,
a view choice keeping it, the listeners, no storage and a throwing one, the
button, the focus under the setting (the quiet voice carried on),
`whileShown`, and a tap with sound off (the setting turned on and saved,
the voice playing through a focused player, no quiet voice carried on in
its place; with sound on, nothing written). `sound-setting.property.test.ts`: through any sequence of
taps, starts, ends and switches, no voice carries on while off and, on, no
silent voice holds the channel. `world-sound.test.ts` drives the real
hand-over (a queued voice behind a freed held one) and the hidden page. `visitor-walk-layout.spec.js` holds
the button on the screen with the list open.
