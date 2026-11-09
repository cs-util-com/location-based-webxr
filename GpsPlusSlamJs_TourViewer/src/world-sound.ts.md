# `world-sound.ts` - the sounds of the free items in the world

## Purpose

The sound seam a world part reaches through `WorldEnv.sound`: one handle per
sound, on one of two channels.

- `"voice"` - a narration. It goes through the page's voice focus
  (`voice-focus.ts`, `focusedPlayer` over `createNarrationPlayer`), so its
  rules are the narrated texts' rules: one voice at a time, a tap wins, one
  paused voice is remembered.
- `"background"` - an ambient sound. It loops; its loudness is set by the
  part every frame, and it is lowered to `BACKGROUND_UNDER_VOICE` (30 %)
  while any voice runs, gliding there over `LOWER_GLIDE_S`
  (`kinds/audio/sound-reach.ts`).

## Public API

- `SoundChannel` - `"voice" | "background"`.
- `SoundHandle`:
  - `play()` - the visitor's play (a voice: through the focus);
  - `pause()` - the visitor's pause: it stays off until played again;
  - `hold()` - the walk's pause (a narration left behind); `wanted()` stays
    true;
  - `carryOn()` - back: plays again only if still wanted;
  - `wanted()`, `playing()`;
  - `timeMs()`, `durationMs()` (0 while not known), `seek(ms)` - a voice's
    clock, read and moved by the narration card; a background says 0 and
    ignores the seek;
  - `level(gain, seconds)` - a background's loudness (0 to 1) at page time
    `seconds`; a voice ignores it;
  - `dispose()` - stops it and frees its element and its object URL.
- `WorldSoundDeps` - `focus` (the page's voice focus), and optional `audio`
  (an element factory, default `new Audio()`), `sound` (a `SoundGate`, the
  page's setting while the page is shown, `sound-setting.ts` `whileShown`;
  default always on), `onError`, `createUrl`, `revokeUrl`.
- `createWorldSound(deps)` -> `WorldSound` with `sound(load, channel)`; `load`
  reads the file once, when it first plays.
- `SILENT_SOUND`, `SILENT_WORLD_SOUND` - do nothing: the editor's, and a page
  without sound.

## Invariants & assumptions

- Nothing is read or played before a `play()` (a voice) or a first non-zero
  `level` (a background).
- With the gate off a voice does not carry on at return (a tap still plays
  it: the visitor's own ask, and the page's focus turns the sound on, as for
  every voice: `sound-setting.ts` `silencedFocus`) and a background is PAUSED, at once (the
  gate's change re-checks every live background, since a hidden page runs
  no frames), and not read before it may be heard: sound off loads and
  plays nothing, never a file at volume 0. The distance loudness is the
  element's `volume`. The
  page's `sound-setting.ts` holds the running voice when sound goes off and
  carries it on when it comes back.
- A play the browser refuses (an autoplay block, a file it cannot decode)
  is reported to `onError` once and not tried again until the sound falls
  silent (a level of 0: the visitor left its reach) or the gate comes back
  on (the sound button is a tap the browser counts; a return to the page).
  An AbortError from a pause of its own is no refusal. One `play()` at a
  time.
- Dispose removes the element's `src` and reloads it, as
  `narration-player.ts` does, so the browser lets the file go.
- A background at level 0 is paused, not only silent, so a far ambient sound
  costs nothing.
- The lowering follows `focus.running()`: any voice of the page lowers the
  background, a narrated text's too.
- A failed play or read goes to `onError`; nothing throws into the frame
  loop.

## Examples

```ts
const worldSound = createWorldSound({ focus: voiceFocus });
const voice = worldSound.sound(() => loadAsset("talk"), "voice");
voice.play(); // a tap inside the circle
voice.hold(); // the visitor walked out
voice.carryOn(); // and back: it plays on
```

## Tests

`world-sound.test.ts`: the voice through the focus (play, hold, carry on, the
visitor's pause staying off), the background's lazy read, its loop and
level, its lowering under a voice over the glide, the sound setting (a pause,
no read while off), a refused play reported once, dispose freeing the
element and the URL; and, wired as `main.ts` wires them, a voice queued
behind a held one staying quiet when that one is freed, off and on again,
and the hidden page.
