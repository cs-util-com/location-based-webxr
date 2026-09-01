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

/** The printed code the AR specs pretend to scan. */
export const E2E_QR_TEXT = "https://gps.csutil.com/tour/?qr=x";

/** A code the tour zip carries NO level for (the unknown-code path). */
export const E2E_QR_UNKNOWN_TEXT = "https://gps.csutil.com/tour/?qr=x&n=9";

/** `qr/<id>.json` for {@link E2E_QR_TEXT}. */
export async function e2eQrLevelEntryName() {
  return qrLevelEntryName(await qrCodeId(E2E_QR_TEXT));
}
