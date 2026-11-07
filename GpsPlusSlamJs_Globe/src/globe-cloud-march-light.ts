/**
 * The near clouds' light, pure: the sun's path through the air, the sky's
 * irradiance at cloud height and the cloud light made of both, from the
 * sun's direction in the march's frame (y up at the camera). The same
 * single-scattering air as the march's shader, so clouds and their aerial
 * perspective agree. Written for every sun: under the horizon the path is
 * long and finite, and what is left of the light is a faint night ambient.
 *
 * @see globe-cloud-march-light.ts.md
 */

type Rgb = readonly [number, number, number];
type Vec3 = readonly [number, number, number];

const R = 6371;
const HR = 8;
const HM = 1.2;
const BR: Rgb = [5.802e-3, 13.558e-3, 33.1e-3];
const BMS = 0.022;
const BME = 0.025;
const BO3: Rgb = [0.65e-3, 1.881e-3, 0.085e-3];
const ESUN = 20;
/** The cloud base the sky's irradiance is taken above (km). */
const CLOUD_BASE_KM = 1.3;
const CLOUD_SUN_SCALE = 0.28;
const CLOUD_AMBIENT_SCALE = 0.45;
const AMBIENT_BOTTOM: Rgb = [0.26, 0.28, 0.23];
/** How far under the ground a sun path may pass (km): keeps it finite. */
const PATH_FLOOR_KM = -50;

/** Starlight on a cloud's top: a dark shape, not a black hole in the sky. */
export const CLOUD_NIGHT_AMBIENT: Rgb = Object.freeze([0.003, 0.004, 0.006]);

const chapman = (x: number, mu: number) => {
  const c = Math.sqrt(1.5707963 * x);
  return c / ((c - 1) * mu + 1);
};

/** The air's column from height `h` along cosine `mu`, scale height `H`. */
function column(h: number, mu: number, H: number): number {
  if (mu >= 0) return H * Math.exp(-h / H) * chapman((R + h) / H, mu);
  const tangent = (R + h) * Math.sqrt(Math.max(0, 1 - mu * mu)) - R;
  const ht = Math.max(tangent, PATH_FLOOR_KM);
  return Math.max(
    0,
    2 * H * Math.exp(-ht / H) * chapman((R + ht) / H, 0) -
      H * Math.exp(-h / H) * chapman((R + h) / H, -mu),
  );
}

const phaseR = (c: number) => 0.0596831 * (1 + c * c);
const phaseM = (c: number, g: number) => {
  const g2 = g * g;
  return (
    (0.1193662 * (1 - g2) * (1 + c * c)) /
    ((2 + g2) * Math.pow(1 + g2 - 2 * g * c, 1.5))
  );
};

const mapRgb = (f: (i: 0 | 1 | 2) => number): Rgb => [f(0), f(1), f(2)];

/** The sun's light left at height `h` along the path `path`. */
function sunThrough(h: number, path: Vec3): Rgb {
  return mapRgb((i) =>
    Math.exp(
      -(
        BR[i] * path[0] * Math.exp(-h / HR) +
        BME * path[1] * Math.exp(-h / HM) +
        BO3[i] * path[2]
      ),
    ),
  );
}

/** The sky's radiance towards direction `d`, seen from height `h`. */
function skyRadiance(h: number, d: Vec3, sun: Vec3, path: Vec3): Rgb {
  const mu = d[1];
  const hmin = Math.max(
    0,
    mu >= 0 ? h : (R + h) * Math.sqrt(Math.max(0, 1 - mu * mu)) - R,
  );
  const cR = column(h, mu, HR);
  const cM = column(h, mu, HM);
  const cosT = d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2];
  const tsR = sunThrough(hmin + 3, path);
  const tsM = sunThrough(hmin + 0.4, path);
  const pm = 0.8 * phaseM(cosT, 0.78) + 0.2 * phaseM(cosT, 0.2);
  return mapRgb((i) => {
    const tau = BR[i] * cR + BME * cM;
    const src =
      tsR[i] * BR[i] * cR * (phaseR(cosT) + 0.012) +
      tsM[i] * BMS * cM * (pm + 0.02);
    return (ESUN * src * (1 - Math.exp(-tau))) / Math.max(tau, 1e-5);
  });
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** The sky's irradiance at height `h`: two directions stand for the dome. */
function skyIrradiance(h: number, sun: Vec3, path: Vec3): Rgb {
  const across = Math.hypot(sun[0], sun[2]);
  // With the sun at the zenith or the nadir any side will do.
  const side: Vec3 =
    across > 1e-6 ? [-sun[2] / across, 0, sun[0] / across] : [1, 0, 0];
  const a = skyRadiance(h, unit([side[0] * 0.6, 1, side[2] * 0.6]), sun, path);
  const b = skyRadiance(h, unit([-sun[0], 0.35, -sun[2]]), sun, path);
  return mapRgb((i) => Math.PI * (0.55 * a[i] + 0.45 * b[i]));
}

/**
 * The cloud sun's least green and blue, as shares of its red: the last light
 * through the air is nearly pure red, and tone mapping drew it crimson.
 */
export const CLOUD_SUN_FLOOR = { green: 0.42, blue: 0.22 } as const;

/** What the march's cloud light is made of (`cloudMarchLight`). */
export interface CloudMarchLight {
  /** Air column, haze column and ozone path of the sun at sea level. */
  readonly sunPath: Vec3;
  readonly cloudSun: Rgb;
  readonly ambientTop: Rgb;
  readonly ambientBottom: Rgb;
}

/**
 * The cloud light for the sun's direction `sun` (unit, y up at the camera).
 * Half desaturated so sunlit tops stay nearly white.
 *
 * @throws RangeError for a sun that is not a direction.
 */
export function cloudMarchLight(sun: Vec3): CloudMarchLight {
  const length = Math.hypot(sun[0], sun[1], sun[2]);
  if (!(length > 0.5 && Number.isFinite(length))) {
    throw new RangeError(`the sun must be a direction, got ${sun.join(", ")}`);
  }
  const cR = column(0, sun[1], HR);
  const path: Vec3 = [cR, column(0, sun[1], HM), (15 * cR) / HR];
  const irradiance = skyIrradiance(CLOUD_BASE_KM + 0.5, sun, path);
  const through = sunThrough(2, path).map((v) => v * ESUN);
  const [r = 0, g = 0, b = 0] = through;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const [red = 0, green = 0, blue = 0] = mapRgb(
    (i) => (lum + ((through[i] ?? 0) - lum) * 0.5) * CLOUD_SUN_SCALE,
  );
  const cloudSun: Rgb = [
    red,
    Math.max(green, CLOUD_SUN_FLOOR.green * red),
    Math.max(blue, CLOUD_SUN_FLOOR.blue * red),
  ];
  const ambientTop = mapRgb(
    (i) => irradiance[i] * CLOUD_AMBIENT_SCALE + CLOUD_NIGHT_AMBIENT[i],
  );
  return {
    sunPath: path,
    cloudSun,
    ambientTop,
    ambientBottom: mapRgb((i) => ambientTop[i] * AMBIENT_BOTTOM[i]),
  };
}
