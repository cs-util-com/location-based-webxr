# sound-step.ts

**Purpose:** the sound step of the asset optimizer's Worker: the samples the page decoded (`sound-optimizer.ts`), encoded as Opus with WebCodecs and written as an Ogg Opus file (`ogg-opus.ts`) exactly as long as they are.

## Public API

- `SOUND_RATE`: 48000, Opus's rate.
- `SoundPayload`: `{ sampleRate: 48000, planes, bitsPerSecond }`.
- `soundPayloadOf(payload)`: the payload as a `SoundPayload`, or null unless it is 48 kHz, one or two `Float32Array` planes of one non-zero length, and a whole bitrate of 6-510 kbps.
- `SoundDevice.encodeOpus(sound, control)` resolves to a module-internal `{ packets, description }` (not exported).
- `optimizeSound(payload, settings, control, device, serial?)`: `{ type: "done", blob (audio/ogg), extension: "opus" }`.
- `SOUND_DEVICE`: the browser's `AudioEncoder`.

## Invariants

- The pre-skip is the encoder's own, read from its OpusHead; a guessed one would shift every caption timed against the sound. An encoder that gives no usable header, or one for other channels, fails the job.
- The file's last granule is pre-skip plus the input's sample count, so it plays exactly as long as the input.
- Samples it cannot trust are refused before encoding ("the sound's samples could not be used").
- A stop throws an `AbortError` and writes nothing.
- `SOUND_DEVICE` feeds one-second `f32-planar` chunks, waits for the encoder whenever more than four are queued (memory stays bounded on a long memo), reports 95 % of the progress while feeding, and closes the encoder on every path.
- WebCodecs needs a secure context (https or localhost). Chromium's encoder does not write Ogg itself (`opus: { format: "ogg" }` is refused), which is why the writer is ours; its default output still carries the OpusHead as the decoder description.

## Tests

- `sound-step.test.ts` with a fake encoder: the payload check, the last granule, the declared pre-skip, a missing or wrong header, refused samples, a stop.
- The real encoder runs in the shelf's optimizer e2e (`playwright-tests/editor-asset-optimizers.spec.js`).
