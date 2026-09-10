/**
 * The printed QR code's quiet zone, and the paper it has to fit on.
 *
 * A module with NO imports and no behaviour, holding two numbers that are a
 * physical contract rather than an implementation detail: everything that
 * puts a code on paper has to agree about them, or one declared size comes
 * out as two different artefacts - and the visitor's pose solve, which is
 * told the printed side in metres, is silently wrong for one of them.
 *
 * It exists as its own file for two reasons, both learned in r665:
 * - **The two printing paths must import the same number, and one of them
 *   is a leaf.** `qr-print-pdf.ts` is a hand-written PDF writer that
 *   deliberately depends on nothing. Reading the fraction from
 *   `qr-print-plan.ts` would have made it depend transitively on the
 *   launch-URL builder, the dictionary codec and base32, to read a float.
 * - **A stylesheet cannot import at all**, so a repo-config test holds the
 *   viewer's print CSS to this value - and a file whose entire content is
 *   the contract is the honest thing for such a test to read.
 */

/**
 * The quiet zone, as a fraction of the symbol side, on EACH edge.
 *
 * **Do not "correct" it to the specification's four modules.** Four modules
 * is a fraction OF THE SYMBOL, so it grows as the symbol shrinks, and every
 * hosting shape this product recommends prints at QR version 5 to 8 - where
 * four modules is 8.2 % to 10.8 %, i.e. at or above this. It would make
 * every real printed code smaller, by up to 7.6 mm on the shortened link
 * the app itself recommends. Measured and pinned in `qr-print-plan.test.ts`
 * ("the printed symbol size real hosting shapes reach") after that
 * arithmetic, done the other way round, cost a round of planning.
 */
export const QR_QUIET_ZONE_FRACTION = 0.08;

/**
 * Printable width (m) a home printer can be relied on for: about 19 cm on
 * A4/Letter with default margins. The paper budget the ceiling divides.
 */
export const HOME_PRINTABLE_WIDTH_M = 0.19;

/**
 * What one metre of declared symbol side actually occupies on paper: the
 * symbol plus its quiet zone on both edges.
 *
 * Named because it was previously a bare `1.16` inside a division, where no
 * reader would find it by searching for the fraction it encodes.
 */
export const QR_PRINT_FOOTPRINT_FACTOR = 1 + 2 * QR_QUIET_ZONE_FRACTION;
