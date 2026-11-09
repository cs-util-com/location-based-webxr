# Landmark fixtures

Five Overpass extracts around landmark churches, captured on 2026-11-07 for the
investigation in
`GpsPlusSlamJs_Docs/docs/2026-11-07-0920-osm-building-geometry-bugs-findings.md`.

- **Licence:** OpenStreetMap data, ODbL 1.0, (c) OpenStreetMap contributors,
  https://www.openstreetmap.org/copyright. Each file repeats this in its
  `licence` field.
- **Source:** `https://overpass-api.de/api/interpreter`; each file keeps its
  exact `query`, `capturedAt`, `trimmedTo` and `elementCount`.
- **How they were chosen:** a fixed list written down before any capture, one
  landmark per roof class the six-site corpus lacks or has only thinly:
  - `dresden-frauenkirche` - a stone dome mapped with round, onion, cone and gambrel parts;
  - `munich-frauenkirche` - two towers with domed caps, plus the Polizeipraesidium courtyard block;
  - `ulm-minster` - the tallest Gothic spire, skillion and pyramidal parts;
  - `berlin-cathedral` - a central dome with lanterns and corner towers;
  - `moscow-st-basil` - onion domes and a tent roof, about 500 parts.
- **Trimmed to** the buildings within the radius recorded in `trimmedTo`, so the
  files stay small; minified per `../fixture-formatting.test.ts`.
- **Read by** `src/mesh/s3db-landmarks.test.ts` and by the DesignSystem's
  building geometry lab (`labs/building-geometry/`).
