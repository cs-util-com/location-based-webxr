/**
 * What the editor on the globe draws, by two pure rules the owner decided
 * (2026-10-28): far away an object hides by its own size on screen (a sign
 * after a few hundred metres, a 200 m object much later), and a station's
 * pin hides once a neighbouring station crowds it on screen. Hidden objects
 * cost nothing, so from above the clouds almost nothing is drawn.
 *
 * Both rules have hysteresis: an object at the edge of a threshold would
 * otherwise blink as the camera drifts by a pixel.
 *
 * @see globe-visibility.ts.md
 */

/** The hysteresis bands of the two rules. */
export const GLOBE_VISIBILITY = Object.freeze({
  /** A hidden object shows again only at `hidePx` x this. */
  showRatio: 1.5,
  /** A crowded pin shows again only with its nearest `crowdPx` x this away. */
  uncrowdRatio: 1.25,
});

const DEG = Math.PI / 180;

function finiteAtLeast(name: string, value: number, min: number): void {
  if (!Number.isFinite(value) || value < min) {
    throw new RangeError(`${name} must be finite and >= ${min}, got ${value}`);
  }
}

/**
 * The diameter in CSS px that a sphere of `radiusM` at `distanceM` from a
 * perspective camera covers on screen: `radius x height / (distance x
 * tan(fovY / 2))`. Infinity with the camera inside the sphere. RangeError
 * for a negative or non-finite radius or distance, a field of view outside
 * (0, 180) degrees or a viewport height that is not positive and finite.
 */
export function screenSizePx(input: {
  readonly radiusM: number;
  readonly distanceM: number;
  readonly fovYDeg: number;
  readonly viewportHeightPx: number;
}): number {
  const { radiusM, distanceM, fovYDeg, viewportHeightPx } = input;
  finiteAtLeast("radiusM", radiusM, 0);
  finiteAtLeast("distanceM", distanceM, 0);
  if (!(fovYDeg > 0 && fovYDeg < 180)) {
    throw new RangeError(`fovYDeg must be in (0, 180), got ${fovYDeg}`);
  }
  if (!(viewportHeightPx > 0) || !Number.isFinite(viewportHeightPx)) {
    throw new RangeError(
      `viewportHeightPx must be positive and finite, got ${viewportHeightPx}`,
    );
  }
  if (distanceM <= radiusM) return Infinity;
  return (
    (radiusM * viewportHeightPx) / (distanceM * Math.tan((fovYDeg * DEG) / 2))
  );
}

/**
 * Whether an object of `sizePx` on screen is drawn, given whether it was
 * drawn last frame: a drawn object hides below `hidePx`; a hidden one shows
 * again only at `hidePx x showRatio` or more. RangeError for a threshold or
 * ratio that is not finite (`hidePx` >= 0, `showRatio` >= 1) or a size that
 * is NaN or negative.
 */
export function sizeShown(
  wasShown: boolean,
  sizePx: number,
  hidePx: number,
  showRatio: number = GLOBE_VISIBILITY.showRatio,
): boolean {
  finiteAtLeast("hidePx", hidePx, 0);
  finiteAtLeast("showRatio", showRatio, 1);
  if (Number.isNaN(sizePx) || sizePx < 0) {
    throw new RangeError(`sizePx must be >= 0, got ${sizePx}`);
  }
  return sizePx >= (wasShown ? hidePx : hidePx * showRatio);
}

/** A station's pin where it lands on screen (CSS px). */
export interface ScreenPin {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/**
 * The ids of the pins hidden by crowding: a pin hides when its nearest
 * other pin on screen is closer than `crowdPx`; a pin hidden last frame
 * (`wasHidden`) shows again only once its nearest is `crowdPx x
 * uncrowdRatio` or further. Every pin counts as a neighbour, hidden or
 * not, so two pins crowding each other both hide. The `selected` pin never
 * hides. `crowdPx` 0 hides nothing. A pin with a coordinate that is not
 * finite (behind the camera) is no one's neighbour and is not hidden here.
 * RangeError for a `crowdPx` or ratio that is not finite (`crowdPx` >= 0,
 * `uncrowdRatio` >= 1).
 */
export function crowdedPins(
  pins: readonly ScreenPin[],
  crowdPx: number,
  wasHidden: ReadonlySet<string>,
  selected: string | null = null,
  uncrowdRatio: number = GLOBE_VISIBILITY.uncrowdRatio,
): Set<string> {
  finiteAtLeast("crowdPx", crowdPx, 0);
  finiteAtLeast("uncrowdRatio", uncrowdRatio, 1);
  const hidden = new Set<string>();
  if (crowdPx === 0) return hidden;
  const placed = pins.filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  for (const pin of placed) {
    if (pin.id === selected) continue;
    let nearest = Infinity;
    for (const other of placed) {
      if (other === pin) continue;
      nearest = Math.min(nearest, Math.hypot(other.x - pin.x, other.y - pin.y));
    }
    const limit = wasHidden.has(pin.id) ? crowdPx * uncrowdRatio : crowdPx;
    if (nearest < limit) hidden.add(pin.id);
  }
  return hidden;
}
