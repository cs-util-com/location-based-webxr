/**
 * Text as a creator page takes it from a text input: in Unicode NFC
 * (design §3 of the station blocks plan, B2a review 6). Keyboards and
 * pastes may hand over a decomposed accent ("e" and a combining mark);
 * stored as typed, the same word would count twice toward a cap on one
 * device and once on another, and a hash of the text (B3b) would differ
 * for text that reads the same. The format's reader does not normalise:
 * normalising is the editor's, at the input.
 *
 * @see input-text.ts.md
 */

/** `value` in NFC. */
export function inputText(value: string): string {
  return value.normalize("NFC");
}
