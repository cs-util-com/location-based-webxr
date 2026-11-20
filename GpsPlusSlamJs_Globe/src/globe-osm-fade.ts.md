# globe-osm-fade.ts

- Purpose: the OpenStreetMap overlay's distance fade and darkening gain,
  patched into the library's overlay layer blend of every relief
  material. `globe-osm-overlay.ts` applies it in `attach`.
- Public API:
  - `patchOsmFade(shader, uniforms)`: patches the library's layer blend
    (`tint.rgba *= layerInfo[ i ].opacity * wOpacity;`, 0.5.3) to fade
    between `uOsmFadeStart x uOsmFadeM` and `uOsmFadeM` from the camera
    and to drop with `uOsmOn` 0; false (untouched) where the line is
    missing. Before the blend it darkens the tile's colour by `uOsmGain`,
    in one of two ways picked by `uOsmFlat`: 1, a flat multiply by g,
    which keeps every contrast of the map (a road and a name against the
    land read as on the tile server's map); 0, its luma L (Rec. 709
    weights) compressed to L g / (g + (1 - g) L), the colour scaled by the
    same factor: white ends at g, a dark line keeps nearly its luma, the
    hue stays, and the map's contrasts are lowered (a name's against the
    land most). g 1 changes nothing in either.
  - `OsmFadeUniforms`: `uOsmFadeM`, `uOsmFadeStart`, `uOsmOn`,
    `uOsmGain`, `uOsmFlat`, one set shared by every patched material.
  - `OsmGainMode`: `"flat"` or `"compress"` (`GLOBE_OSM.gainMode`).
- Invariants & assumptions:
  - The patch anchors on the library's exact blend line (3d-tiles-renderer
    0.5.3, `wrapOverlaysMaterial.js`) and on `#include <common>` for its
    declarations; a library change that drops the line leaves the shader
    untouched and returns false (the overlay counts it in
    `unpatchedShaders`), never a map drawn at every distance.
  - With the sea compiled (`GLOBE_SEA`) the patch also writes the map's
    alpha to `globeMapShare`, and the sea stays under the drawn map by
    that share.
- Example:

  ```ts
  material.onBeforeCompile = (shader) => {
    if (!patchOsmFade(shader, uniforms)) unpatched += 1;
  };
  ```

- Tests: `globe-osm-fade.test.ts` (the patch against the library's own
  blend line read from its source, the gain compressing the luma or
  multiplying flat, the sea's share, and a shader without the line left
  untouched).
