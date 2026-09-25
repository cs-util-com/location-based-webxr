import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
import type { EnableGpsArStatus } from "gps-plus-slam-app-framework/ar/enable-gps-ar";

import type { TourCoord } from "../../store/types.js";

/** Under this the visitor is at the start: no notice, plain Enter AR. */
const NEAR_M = 50;
/** Beyond this, AR is taken away — nothing in the tour could ever trigger. */
const FAR_M = 300;
/** A fix coarser than this cannot tell near from mid, so it is not trusted. */
const MAX_TRUSTED_ACCURACY_M = 50;

/** The visitor's position as the Geolocation API reports it. */
export interface VisitorFix {
  readonly lat: number;
  readonly lon: number;
  /** Metres, 1σ-ish radius as reported by the browser. */
  readonly accuracy: number;
}

export type StartProximity =
  | { readonly kind: "unknown" }
  | { readonly kind: "near" }
  | { readonly kind: "mid"; readonly distanceM: number }
  | { readonly kind: "far"; readonly distanceM: number };

/**
 * Horizontal metres from the fix to the tour's start. Altitude is never read
 * (D17): it is the noisiest GPS axis, and this check only ever needs "how far
 * along the ground".
 */
export function distanceToStartM(fix: VisitorFix, start: TourCoord): number {
  // Take the shorter way round the antimeridian, so two points a few metres
  // apart either side of ±180° are not read as 40,000 km apart.
  const lonDelta = ((((fix.lon - start.lon) % 360) + 540) % 360) - 180;
  const nue = calcRelativeCoordsInMeters(
    { lat: start.lat, lon: start.lon },
    { lat: fix.lat, lon: start.lon + lonDelta },
    0,
    0,
  );
  return Math.hypot(nue[0], nue[2]);
}

/**
 * Near / mid / far / unknown from a distance and the fix's accuracy.
 *
 * "Far" needs only a lower bound — if even the best case is beyond `FAR_M` the
 * answer is certain however coarse the fix, which is what keeps a visitor
 * indoors at home (a ±80 m Wi-Fi fix, 4,000 km away) from being offered AR.
 * "Near" and "mid" need a fix good enough to tell them apart. Anything else is
 * unknown, and unknown never removes AR.
 */
export function classifyStartDistance(
  distanceM: number,
  accuracyM: number,
): StartProximity {
  if (!Number.isFinite(distanceM) || !Number.isFinite(accuracyM)) {
    return { kind: "unknown" };
  }
  if (distanceM - accuracyM > FAR_M) return { kind: "far", distanceM };
  if (accuracyM > MAX_TRUSTED_ACCURACY_M) return { kind: "unknown" };
  if (distanceM < NEAR_M) return { kind: "near" };
  return { kind: "mid", distanceM };
}

/** Worth ending the wait for: the fix already settles the question. */
export function isDecisive(fix: VisitorFix, start: TourCoord): boolean {
  return (
    classifyStartDistance(distanceToStartM(fix, start), fix.accuracy).kind !==
    "unknown"
  );
}

/**
 * Visitor-facing distance. Never claims precision it does not have: an
 * equirectangular-style conversion is trustworthy at hundreds of metres, not
 * across continents, so beyond 100 km the number is not shown at all.
 */
export function formatStartDistance(distanceM: number): string {
  if (distanceM < 1_000) return `${Math.round(distanceM / 10) * 10} m`;
  if (distanceM < 100_000) return `about ${Math.round(distanceM / 1_000)} km`;
  return "more than 100 km";
}

/** What the tour-entry screen shows, as plain data. */
export interface EntryView {
  /** False removes the Enter AR button altogether (far). */
  readonly arVisible: boolean;
  readonly arEnabled: boolean;
  readonly previewOffered: boolean;
  readonly message: {
    readonly text: string;
    readonly tone: "info" | "error";
  } | null;
}

/**
 * The whole entry-screen policy in one place: what the AR controller says
 * about this device × `&preview=1` × how far the visitor is from the start.
 *
 * Precedence: an unsupported device gets preview only (distance is moot); a
 * far visitor loses AR whatever else is going on (an AR error is moot once AR
 * is gone); then the controller's own checking / error states; then the
 * distance notice. A missing or coarse fix (`unknown`) behaves exactly like
 * `near` — it must never take AR away.
 */
export function deriveEntryView(input: {
  readonly controllerStatus: EnableGpsArStatus;
  readonly controllerError: string | null;
  readonly forcePreview: boolean;
  readonly proximity: StartProximity | "locating";
}): EntryView {
  const { controllerStatus, controllerError, forcePreview, proximity } = input;

  if (controllerStatus === "unsupported") {
    return {
      arVisible: true,
      arEnabled: false,
      previewOffered: true,
      message: {
        text: "AR is not available in this browser. You can walk the tour on this screen instead, or follow it on the map.",
        tone: "error",
      },
    };
  }

  if (proximity !== "locating" && proximity.kind === "far") {
    return {
      arVisible: false,
      arEnabled: false,
      previewOffered: true,
      message: {
        text: `The start of this tour is ${formatStartDistance(proximity.distanceM)} away. Preview it from here.`,
        tone: "info",
      },
    };
  }

  if (controllerStatus === "checking") {
    return {
      arVisible: true,
      arEnabled: false,
      previewOffered: forcePreview,
      message: { text: "Checking AR support…", tone: "info" },
    };
  }

  if (proximity === "locating") {
    return {
      arVisible: true,
      arEnabled: false,
      previewOffered: forcePreview,
      message: {
        text: "Checking how far you are from the start…",
        tone: "info",
      },
    };
  }

  const midOffered = proximity.kind === "mid";
  const previewOffered = forcePreview || midOffered;

  if (controllerStatus === "error") {
    return {
      arVisible: true,
      arEnabled: true,
      previewOffered,
      message: {
        text:
          controllerError ??
          "AR could not be started. Check camera and location access, then try again.",
        tone: "error",
      },
    };
  }

  return {
    arVisible: true,
    arEnabled: true,
    previewOffered,
    message: midOffered
      ? {
          text: `The start of this tour is ${formatStartDistance(proximity.distanceM)} away.`,
          tone: "info",
        }
      : null,
  };
}
