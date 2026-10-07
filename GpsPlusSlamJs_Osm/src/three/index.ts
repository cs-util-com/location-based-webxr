/**
 * `gps-plus-slam-osm/three`: the city as three.js objects. A separate entry
 * point so the package's core stays free of three.js (globe city plan
 * 2026-10-05-0040 §14 L5); three is an optional peer, needed only here.
 */
export {
  buildingObjects,
  cityObjects,
  disposeCityObjects,
  geometryFrom,
  treeObjects,
} from "./city-objects.js";
