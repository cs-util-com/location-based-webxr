/**
 * V3: the city as an architect's massing model. Near-white card with thin
 * storey lines in real metres, pitched sheets on the rectangles nobody tagged,
 * and ground, roads and trees in the same materials so it reads as one object.
 *
 * @see v3-architects-model.js.md
 */
import { startCityLook } from "../city-look-harness.js";
import { buildModelCity } from "./v3-city-mesh.js";
import { modelBuildingMaterial, modelMaterialFor } from "./v3-model-shader.js";
import { ROOF_TOLERANCE } from "./v3-model-rules.js";

/** The chosen look; each value can be overridden by a link parameter. */
const LOOK = {
  white: 1,
  lineStrength: 0.55,
  lineHalfM: 0.05,
  bayM: 2.8,
  bayDepth: 0.42,
  neutral: 0.75,
  fill: 1.2,
  aoRadius: 6,
  aoScale: 1.2,
  groundColour: "#b9b4aa",
  roadColour: "#d3cfc6",
  treeColour: "#bcc6b0",
};

/** `LOOK` with any matching link parameter applied. */
function readLook(search) {
  const query = new URLSearchParams(search);
  const look = { ...LOOK };
  for (const key of Object.keys(LOOK)) {
    const raw = query.get(key);
    if (raw === null) continue;
    const number = Number(raw);
    if (typeof LOOK[key] === "number" && Number.isFinite(number)) {
      look[key] = number;
    } else if (typeof LOOK[key] === "string" && /^[0-9a-f]{6}$/i.test(raw)) {
      look[key] = `#${raw}`;
    }
  }
  return look;
}

const look = readLook(location.search);

startCityLook({
  id: "v3",
  label: "V3 architect's model",
  postprocess: "gtao",
  aoParams: { radius: look.aoRadius, scale: look.aoScale },
  buildingsFor: (features, ctx) =>
    buildModelCity(features, ctx, {
      material: modelBuildingMaterial(ctx.THREE, look),
      tolerance: ROOF_TOLERANCE,
    }),
  materialFor: (kind, material) => modelMaterialFor(kind, material, look),
});
