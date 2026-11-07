# globe-cloud-march-frame.ts

Purpose: keeps the near clouds' weather frame: the tangent frame the march works in and `q`, the place in the dome tiles, as the camera moves over the Earth.

## Public API

- `CLOUD_MARCH_RADIUS_KM`: the march's sphere (6371).
- `cloudWeatherFrameAt(up)`: a frame from scratch.
- `advanceCloudWeatherFrame(frame, up)`: the frame carried to a new up; `q` grows by the motion.

## Invariants

- Parallel transported, never rebuilt from east and south: a frame tied to them turns under a camera moving east at a high latitude and has no east at a pole.
- `q` is the integral of the motion, so the field never slides under the camera. The price: the dome pattern at a place depends on the route that reached it. The map still decides where the clouds are, so only the shapes of single clouds differ.
- A camera that jumps far is restarted by the caller, not transported.

## Example

```ts
let frame = cloudWeatherFrameAt(up);
frame = advanceCloudWeatherFrame(frame, nextUp);
```

## Tests

`globe-cloud-march-frame.test.ts`, with property tests: no rotation under an eastward flight, a pass over the pole.
