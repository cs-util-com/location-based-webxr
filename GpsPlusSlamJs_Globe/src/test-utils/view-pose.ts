/**
 * The view's pose maths and its ellipsoid for an app's tests (the Tour
 * Viewer's editor checks its poses against the view's own): `viewPoseEcef`
 * from the view core and the tile renderer's `WGS84_ELLIPSOID` the view
 * uses, for a package without the tile renderer as its own dependency.
 *
 * Test support only: production never imports it.
 */
export { viewPoseEcef } from "../globe-view.js";
export { WGS84_ELLIPSOID } from "3d-tiles-renderer";
