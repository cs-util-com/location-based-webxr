/**
 * The look-dev page's probes of the clouds in front of the sun (round-3 plan
 * 2026-09-27-0532, stream D): where the framework's CPU twins put the
 * clouds, so a smoke test can pick a sky with a cloud of a known thickness
 * in front of the sun, or over a ground point, and measure the shader
 * against the no-effect baseline at the same pixels.
 *
 * Page-side test support only; the model lives in the framework
 * (`cloud-column.ts`, `cloud-sun.ts`).
 *
 * @see sun-clouds.js.md
 */
import {
  CLOUD_LAYER,
  CLOUD_TEXTURE_SIZE,
  cloudHorizonFade,
  cloudNoise,
  cloudNoiseSample,
} from "/fw/visualization/atmosphere/cloud-layer.js";
import {
  cloudColumnDistanceM,
  cloudColumnOpticalDepth,
  cloudColumnTransmittanceToward,
  cloudColumnUv,
} from "/fw/visualization/atmosphere/cloud-column.js";
import { cloudSlabFarWeight } from "/fw/visualization/atmosphere/cloud-slab.js";

/** The sky's noise texture: `SkyAtmosphere`'s default size and seed. */
const SEED = 1;

const unit = (v) => {
  const l = Math.hypot(v.x, v.y, v.z);
  return [v.x / l, v.y / l, v.z / l];
};

export function createSunCloudProbe() {
  const data = cloudNoise(CLOUD_TEXTURE_SIZE, SEED);
  const noiseAt = (u, v) => cloudNoiseSample(data, CLOUD_TEXTURE_SIZE, u, v);
  const clouds = (atmosphere) => {
    const u = atmosphere.cloudUniforms;
    const offset = u.atmCloudOffset.value;
    return {
      threshold: u.atmCloudThreshold.value,
      offset: [offset.x, offset.y],
    };
  };
  return {
    /**
     * The clouds in front of the sun from `cameraPosition`: the column's
     * optical depth `tau` along the sun, the share of it DRAWN there
     * (`drawn`: the dome's horizon fade, or the sheet's and the slab's far
     * fade, times the aerial melt; the sky's disc reads tau × drawn), and
     * the noise read. The dome's clouds are camera-centred at the origin,
     * the sheet's and the slab's in the world (as the sky's disc reads them).
     */
    atSun(atmosphere, cameraPosition, sun) {
      const { threshold, offset } = clouds(atmosphere);
      const dir = unit(sun);
      if (!(dir[1] > 0) || threshold >= 2) {
        return { tau: 0, drawn: 0, noise: null };
      }
      const anchored = atmosphere.cloudMode !== "dome";
      const origin = anchored
        ? [cameraPosition.x, cameraPosition.y, cameraPosition.z]
        : [0, 0, 0];
      const [u, v] = cloudColumnUv(origin, dir, offset);
      const noise = noiseAt(u, v);
      const s = cloudColumnDistanceM(origin[1], dir[1]);
      const aerial = Math.exp((-s * 0.001) / CLOUD_LAYER.aerialKm);
      const horizontal = Math.hypot(dir[0], dir[2]);
      const drawn =
        aerial *
        (anchored
          ? cloudSlabFarWeight(s * horizontal)
          : cloudHorizonFade(dir[1]));
      return {
        tau: cloudColumnOpticalDepth(noise, threshold, origin[1], dir[1]),
        drawn,
        noise,
      };
    },
    /**
     * The share of the sun reaching the world point `point` ([x, y, z]
     * metres) through the clouds: the cloud shadow patch's CPU twin.
     */
    shadowAt(atmosphere, point, sun) {
      const { threshold, offset } = clouds(atmosphere);
      return cloudColumnTransmittanceToward(
        point,
        unit(sun),
        threshold >= 2 ? Number.POSITIVE_INFINITY : threshold,
        noiseAt,
        offset,
      );
    },
  };
}
