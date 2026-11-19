# voice-credit.ts

## Purpose

A narration's voice credit (the "Spoken by" line the visitor sees after the speaker's name) in the one form the editor stores: the session normalises what the creator types with it, and the tour document's reducer refuses a credit the format would not take.

## Public API

- `VOICE_CREDIT_MAX` - the most letters a credit keeps: the format's cap, `TOUR_NARRATION_RULES.voiceCredit.max` (200).
- `normalVoiceCredit(text): string | undefined`
  - trims, turns every whitespace run (tabs, line breaks, no-break spaces) into one space, cuts to `VOICE_CREDIT_MAX` code points and trims the cut end;
  - `undefined` when nothing is left: an empty credit means none, so the narration then carries no `voiceCredit` field.

## Invariants

- The result always passes the format's rule (`checkTourBlockText`): it is never blank and its count (`tourTextCount`, which collapses whitespace) equals its length in code points, at most the cap.
- Idempotent: a stored credit normalised again is unchanged, so a field re-shown and left alone is no edit.
- A cut never splits a surrogate pair (it counts code points), and never rewrites what it keeps: the result starts the collapsed text.

## Examples

```ts
normalVoiceCredit("  Read by   Anna\tBerg "); // "Read by Anna Berg"
normalVoiceCredit("   "); // undefined
```

## Tests

`voice-credit.property.test.ts`: the format's rule holds for any text, idempotence, a text within the cap kept word for word, the cut by letters.
