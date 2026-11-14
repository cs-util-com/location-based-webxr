# sound-optimizer.ts

**Purpose:** the sound row of the optimizer table, its page half: the file decoded on the page at 48 kHz (a Worker has no audio decoder), speech or music settings chosen, and the samples handed to the Worker's sound step (`sound-step.ts`).

## Public API

- `NO_SAMPLES`: the words a sound of no samples is kept with.
- `DecodedSound`: the part of an `AudioBuffer` the row reads.
- `SoundDecoder.decode(source)`: the decoded sound at 48 kHz; rejects for bytes that are no sound.
- `soundOptimizer(decoder)`: the `AssetOptimizer` of the `audio` row.
- `SOUND_DECODER`: `decodeAudioData` of a 48 kHz `OfflineAudioContext`, which resamples to it.

## Invariants

- A mono sound gets the speech settings, a sound of two or more channels the music settings (its first two channels). A target of one channel averages every channel down.
- The samples are copied out of the decoded sound and their buffers TRANSFERRED to the Worker: a 3-minute memo is tens of MB, and the copy keeps the decoded sound intact on the page.
- The decode is the first 15 % of the progress; the Worker's progress fills the rest.
- Bytes that cannot be decoded fail with words ("it could not be read as a sound"); a decode at another rate than 48 kHz fails; a sound of no samples is kept without starting the Worker.

## Known limits

- The speech or music choice is by channels only: a stereo voice memo gets the music bitrate, a mono piece of music the speech bitrate.

## Tests

`sound-optimizer.test.ts` with a fake decoder and host: speech and music, the copy and the transfer, the downmix, progress, a failed decode, no samples, another rate. The real decoder runs in the shelf's optimizer e2e (`playwright-tests/editor-asset-optimizers.spec.js`).
