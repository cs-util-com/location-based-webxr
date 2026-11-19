# voice-credit.ts

## Purpose

A narration's voice credit (the "Spoken by" line the visitor sees after the speaker's name) in the one form the editor stores: the session normalises what the creator types with it, and the tour document's reducer refuses a credit the format would not take.

## Public API

- `VOICE_CREDIT_MAX` - the most letters a credit keeps: the format's cap, `TOUR_NARRATION_RULES.voiceCredit.max` (200).
- `normalVoiceCredit(text, rule?): string | undefined` (`rule` defaults to the format's `TOUR_NARRATION_RULES.voiceCredit`; a test passes another to check the cut in either unit)
  - puts the text in NFC (`inputText`, as every text the editor takes), trims, turns every whitespace run (tabs, line breaks, no-break spaces) into one space, cuts to the rule's cap in the rule's own unit (`tourTextCount`, letter by letter, so never inside a surrogate pair) and trims the cut end;
  - `undefined` when nothing is left: an empty credit means none, so the narration then carries no `voiceCredit` field.
- `voiceCreditCut(text, rule?): boolean` - whether `normalVoiceCredit` cuts `text`: the count of its collapsed NFC line in the format's own `tourTextCount`, in the rule's unit, is above the rule's cap. Cut and count use the same unit, so they agree under either unit, not only because the format happens to count code points. The narration section then adds "Cut to 200 letters." to its toast (the field's `maxLength` is twice the cap, in UTF-16 units, so a longer text can be typed). When letters are typed past a credit already at the cap, the stored credit is unchanged and no edit runs; the section then says the cap instead.

## Invariants

- The result always passes the format's rule (`checkTourBlockText`): it is never blank and its count (`tourTextCount`, which collapses whitespace) equals its length in code points, at most the cap.
- Idempotent: a stored credit normalised again is unchanged, so a field re-shown and left alone is no edit.
- A decomposed letter (a letter and a combining mark) counts once: it is stored composed, so the same name is never cut on one device and kept on another.
- A cut never splits a surrogate pair (it keeps whole letters), and never rewrites what it keeps: the result starts the collapsed text.

## Examples

```ts
normalVoiceCredit("  Read by   Anna\tBerg "); // "Read by Anna Berg"
normalVoiceCredit("   "); // undefined
```

## Tests

`voice-credit.property.test.ts`: the format's rule holds for any text, idempotence, a text within the cap kept word for word, the cut by letters, `voiceCreditCut` true exactly when the collapsed NFC text is longer than the cap, a decomposed letter counted and stored as one, an astral letter counted once, and the cut in the rule's own unit under a code-point and a UTF-16 rule (property). `editor/narration/narration-section.test.ts` pins the toasts, the one for letters typed past a credit at the cap among them.
