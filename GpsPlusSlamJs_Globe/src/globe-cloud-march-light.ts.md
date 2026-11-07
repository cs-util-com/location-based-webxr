# globe-cloud-march-light.ts

Purpose: the near clouds' light, pure: the sun's path through the air, the sky's irradiance at cloud height and the cloud light made of both, from the sun's direction in the march's frame.

## Public API

- `cloudMarchLight(sun): CloudMarchLight`: the sun's and the sky's colour for the march's uniforms, from a unit vector, y up at the camera.
- `CLOUD_NIGHT_AMBIENT`: the faint light that stays at night.

- `CLOUD_SUN_FLOOR`: the cloud sun's least green and blue as shares of its
  red. Half desaturated, the last light through the air stays nearly pure
  red, drawn crimson. Above about 3 degrees the floor does not act, so the
  day keeps the page's light.

## Invariants

- The same single-scattering air as the march's shader, so clouds and their aerial perspective agree.
- Finite for every sun: under the horizon the path is long, not infinite, and the night ambient is what is left.
- Radiance as the check page has it: no scale between this and the tone curve.

## Example

```ts
const { sun, sky } = cloudMarchLight([0, 0.7, 0.71]);
```

## Tests

`globe-cloud-march-light.test.ts`: noon, sunset, night, a sweep of sun angles.
