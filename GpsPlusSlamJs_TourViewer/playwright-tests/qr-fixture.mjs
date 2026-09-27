/**
 * The one place the e2e suite says which printed code it is pretending to
 * scan, and what that code's level file is therefore called inside the tour
 * zip.
 *
 * Both halves have to agree exactly: the archive server writes the entry, the
 * spec arms the detection, and a mismatch shows up only as "unknown code" —
 * a passing-looking failure. So the entry name is DERIVED from the armed text
 * with the framework's own functions rather than written out by hand.
 */

import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
import { qrLevelEntryName } from "gps-plus-slam-app-framework/ar/qr/qr-level-archive";

/** The local test archive the printed code names. */
export const E2E_QR_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/tour.zip";

/**
 * The printed code the AR specs pretend to scan: a launch link whose `qr`
 * payload is the local test archive, as step 3 prints it. Since step 4
 * opens the tour a code names (scan-to-open plan §9), a payload naming
 * anything else would send a creator spec's scan to that host - a real
 * network request - and switch away from the tour the spec opened.
 */
export const E2E_QR_TEXT = `https://gps.csutil.com/tour/?qr=${encodeURIComponent(E2E_QR_ARCHIVE)}`;

/** A code the tour zip carries NO level for (the unknown-code path): the
 *  same tour, another text, so its level id differs. */
export const E2E_QR_UNKNOWN_TEXT = `${E2E_QR_TEXT}&n=9`;

/** `qr/<id>.json` for {@link E2E_QR_TEXT}. */
export async function e2eQrLevelEntryName() {
  return qrLevelEntryName(await qrCodeId(E2E_QR_TEXT));
}
