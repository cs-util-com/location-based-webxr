/**
 * The last 512 bytes of two real Overpass answers to the tile query
 * (generators 0.7.62.11 and 0.7.62.4, saved in November 2026), so the tail
 * checks are tested against what the operators send rather than against a
 * layout written to match the checks. Map data (c) OpenStreetMap
 * contributors, ODbL 1.0.
 */

/** A dense city tile whose last element is a relation with tags. */
export const REAL_TAIL_A =
  '{ "lat": 41.4160407, "lon": 2.1713757 },\n         { "lat": 41.4161978, "lon": 2.1715356 }\n      ]\n    },\n    {\n      "type": "way",\n      "ref": 1556543299,\n      "role": "outer",\n      "geometry": [\n         { "lat": 41.4161978, "lon": 2.1715356 },\n         { "lat": 41.4161558, "lon": 2.1716286 }\n      ]\n    }\n  ],\n  "tags": {\n    "access": "no",\n    "leisure": "nature_reserve",\n    "name": "Àrea restringida de promoció de la biodiversitat",\n    "natural": "wood",\n    "type": "multipolygon"\n  }\n}\n\n  ]\n}\n';

/** Another operator version; the same closing layout. */
export const REAL_TAIL_B =
  'lon": -0.0626081 },\n         { "lat": 51.5167490, "lon": -0.0627084 },\n         { "lat": 51.5164838, "lon": -0.0626466 },\n         { "lat": 51.5164918, "lon": -0.0625496 },\n         { "lat": 51.5165018, "lon": -0.0624210 },\n         { "lat": 51.5165029, "lon": -0.0624143 },\n         { "lat": 51.5167694, "lon": -0.0624769 }\n      ]\n    }\n  ],\n  "tags": {\n    "amenity": "university",\n    "education": "university",\n    "name": "Queen Mary Universtiy Whitechapel Campus",\n    "type": "multipolygon"\n  }\n}\n\n  ]\n}\n';
