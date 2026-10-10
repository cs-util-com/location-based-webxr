/**
 * The look-dev page's sun-through-clouds policy and probes (round-3 plan
 * 2026-09-27-0532, stream D): the disc exponent the page opens with, and
 * where the framework's CPU twins put the clouds, so a smoke test can pick
 * a sky with a cloud of a known thickness in front of the sun, or over a
 * ground point, and measure the shader against the no-effect baseline at
 * the same pixels.
 *
 * Page-side only; the model lives in the framework (`cloud-column.ts`,
 * `cloud-sun.ts`, `SkyAtmosphere.cloudTransmittanceToward`).
 *
 * @see sun-clouds.js.md
 */
import { cloudNoiseSample } from "/fw/visualization/atmosphere/cloud-layer.js";
import {
  cloudColumnDistanceM,
  cloudColumnDrawn,
  cloudColumnOpticalDepth,
  cloudColumnUv,
} from "/fw/visualization/atmosphere/cloud-column.js";

/**
 * The disc's extinction exponent the page opens with (the framework's
 * default is 0, off): a disc behind a column of optical depth ~3 merges
 * into the cloud. Page policy, not a framework constant (round-3 review,
 * finding 9).
 */
export const PAGE_DISC_EXPONENT = 4;

const unit = (v) => {
  const l = Math.hypot(v.x, v.y, v.z);
  return [v.x / l, v.y / l, v.z / l];
};

export function createSunCloudProbe() {
  return {
    /**
     * The clouds in front of the sun from `cameraPosition`: the column's
     * optical depth `tau` along the sun, the share of it DRAWN there
     * (`drawn`, the framework's `cloudColumnDrawn`: the dome's horizon fade,
     * or the sheet's and the slab's far fade, times the aerial melt; the
     * sky's disc reads tau × drawn), and the noise read, from the sky's own
     * live noise texture. The dome's clouds are camera-centred at the
     * origin, the sheet's and the slab's in the world (as the disc reads
     * them).
     */
    atSun(atmosphere, cameraPosition, sun) {
      const u = atmosphere.cloudUniforms;
      const threshold = u.atmCloudThreshold.value;
      const dir = unit(sun);
      if (!(dir[1] > 0) || threshold >= 2) {
        return { tau: 0, drawn: 0, noise: null };
      }
      const anchored = atmosphere.cloudMode !== "dome";
      const origin = anchored
        ? [cameraPosition.x, cameraPosition.y, cameraPosition.z]
        : [0, 0, 0];
      const image = u.atmCloudTexture.value.image;
      const offset = u.atmCloudOffset.value;
      const [tu, tv] = cloudColumnUv(origin, dir, [offset.x, offset.y]);
      // The field the sky draws: hex-tiled when the sky's switch is on.
      const noise = cloudNoiseSample(image.data, image.width, tu, tv, {
        hex: u.atmCloudHex?.value === 1,
      });
      const s = cloudColumnDistanceM(origin[1], dir[1]);
      const fade = u.atmCloudFarFadeM.value;
      const drawn = cloudColumnDrawn(
        s,
        s * Math.hypot(dir[0], dir[2]),
        dir[1],
        anchored,
        [fade.x, fade.y],
      );
      return {
        tau: cloudColumnOpticalDepth(noise, threshold, origin[1], dir[1]),
        drawn,
        noise,
      };
    },
    /**
     * The share of the sun reaching the world point `point` ([x, y, z]
     * metres) through the clouds, the same from every viewpoint: the cloud
     * shadow patch's CPU twin (the framework's
     * `SkyAtmosphere.cloudShadowToward`).
     */
    shadowAt(atmosphere, point) {
      return atmosphere.cloudShadowToward(point);
    },
  };
}
