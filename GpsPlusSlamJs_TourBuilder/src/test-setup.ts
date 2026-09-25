/**
 * Global vitest setup for `gps-plus-slam-tour-builder`.
 *
 * Activates the `gps-plus-slam-js` library once at process start with the
 * bundled community key, so licensed math exports (`calcRelativeCoordsInMeters`
 * and friends, used by `src/app/viewing/ar-seams.ts`) are callable from tests
 * without each one first constructing a store.
 *
 * In the running app the same activation happens implicitly: the store
 * factories wrap `createSlamAppStore`, which activates the library — and both
 * app modes build their store before any geo math runs.
 *
 * Same pattern as `GpsPlusSlamJs_AppFramework/src/test-setup.ts`.
 */
// Both come through the framework's own re-export surface — TourBuilder
// depends on `gps-plus-slam-app-framework`, never on the closed core directly.
import { validateLicenseKey } from "gps-plus-slam-app-framework/core";
import { COMMUNITY_LICENSE_KEY } from "gps-plus-slam-app-framework/licensing";

validateLicenseKey(COMMUNITY_LICENSE_KEY);

// jsdom's Blob has no `stream()` (unlike Node's own Blob), which zip.js's
// BlobReader/BlobWriter rely on. Only the `@vitest-environment jsdom` tests
// (DOM-driven composed flows, e.g. authoring-app.test.ts) hit this; the
// default node environment already has a real stream()-capable Blob.
if (
  typeof Blob !== "undefined" &&
  typeof Blob.prototype.stream !== "function"
) {
  Blob.prototype.stream = function (
    this: Blob,
  ): ReadableStream<Uint8Array<ArrayBuffer>> {
    const getArrayBuffer = this.arrayBuffer.bind(this);
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      async start(controller) {
        controller.enqueue(new Uint8Array(await getArrayBuffer()));
        controller.close();
      },
    });
  };
}
