/**
 * TourBuilder app entry (Goal-2 composition). Mode is decided once, at
 * bootstrap, by `?tour=` presence (contract D13) — see `mode.ts`.
 */
import { isPreviewRequested, resolveAppMode } from "./mode.js";
import { mountLandingScreen } from "./landing/landing-screen.js";
import { mountViewingApp } from "./viewing/viewing-app.js";

const root = document.getElementById("app-root");
if (root === null) {
  throw new Error("app root element not found");
}

const url = new URL(location.href);
const mode = resolveAppMode(url);

if (mode === "authoring") {
  mountLandingScreen(root);
} else {
  // `?tour=` is read once, here: component 6 owns the zip reading and the
  // share-link normalisation, but not the URL parsing (its decision C3).
  mountViewingApp(root, url.searchParams.get("tour") ?? "", {
    forcePreview: isPreviewRequested(url),
  });
}
