# `sound-setting.ts` - sound on or off for every tour

## Purpose

The visitor's sound setting, remembered on the device for every tour, and
what it does to the page's sounds:

- no voice starts by itself while it is off, and turning it off holds the
  voice that is playing (`silencedFocus`, over the page's voice focus, so
  narrated texts, figures and free narrations alike);
- a free ambient sound plays at volume 0 (`world-sound.ts` `soundOn`);
- a free narration does not carry on at a return (`world-sound.ts`).

A tap still plays a voice: it is the visitor's own ask.

## Public API

- `SoundSetting` - `on()`, `set(on)`, `onChange(listener)` (every change,
  not a repeat; returns its unsubscribe).
- `createSoundSetting({ storage })` - read once from the `sound` field of the
  visitor's one prefs key (`visitor-prefs.ts` `VISITOR_PREFS_KEY`); anything
  but `"off"` is on.
- `bindSoundToggle(button, setting)` - the list's sound button
  (`#walk-sound`): `aria-pressed` true while off, a label saying what a
  press does, `data-sound`; a press flips the setting. Returns its unbind.
- `silencedFocus(focus, setting)` - `focus` with `selfStart` refused while
  off, and the running voice held when it goes off.

## Invariants & assumptions

- A write merges `sound` into a FRESH read of the key, never into the value
  read at the start, so a view choice another tab wrote since is kept; a
  view choice (`storeVisitorChoice`) keeps `sound` the same way.
- No storage, or one that throws or holds no JSON: the setting starts on and
  lasts the page.
- The page makes one setting and one `silencedFocus` (`main.ts`).
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
button, and the focus under the setting. `visitor-walk-layout.spec.js` holds
the button on the screen with the list open.
