/**
 * Licence activation for `gps-plus-slam-app-framework` tests that need it.
 *
 * Activates the `gps-plus-slam-js` library using the public
 * `validateLicenseKey()` API and the bundled `COMMUNITY_LICENSE_KEY`, so
 * every reducer / action creator / selector / math export is callable from
 * a test without constructing a store first. Imported first by each test
 * file that needs it (and loaded by the bench config's setupFiles); not a
 * global unit-test setup, because the activation costs about 0.1 s per file
 * and most files never reach a licensed export.
 *
 * Same pattern RecorderApp's integration tests use (see
 * GpsPlusSlamJs_RecorderApp/src/state/recording-replay.integration.test.ts).
 */
import { validateLicenseKey } from 'gps-plus-slam-js';

import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-js/community-license-key';

validateLicenseKey(COMMUNITY_LICENSE_KEY);
