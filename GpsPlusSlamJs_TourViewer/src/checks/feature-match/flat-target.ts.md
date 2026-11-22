# flat-target.ts

## Purpose

The pure rules of the flat target capture mode of `feature-match-check.html`: surface classes, poses, light bins, the four reference corners, the homography that straightens a surface, the guide frame, file names and the per-surface JSON. No DOM; the page side is `flat-capture.ts`, the progress `flat-progress.ts`.

## Public API

- `Point { x, y }`, `Size { width, height }`, `Rect` (both).
- `SURFACE_CLASSES`: `busy` (busy picture), `text` (text-heavy), `low` (low-texture); `SurfaceClass` is an id.
- `DISTANCES` `[40, 20, 12]` (surface width as % of the frame width), `TILTS` `[0, 40]` (deg); `PoseId` is `w<d>-t<t>`, `poseId(d, t)`; `POSES` in capture order w40-t0, w40-t40, w20-t0, w20-t40, w12-t0, w12-t40, each with `distance`, `tilt` and a label like "40 % wide, 0 deg".
- `LIGHT_BINS`: b1 `>= 0.85`, b2 `0.6-0.85`, b3 `0.35-0.6`, b4 `< 0.35`, each with its lower bound `min`; `BinId`.
- `lightBin(ratio)`: the bin of a luma ratio; a bound belongs to the brighter bin, above 1 is b1; throws `RangeError` on a negative or non-finite ratio.
- `lumaRatio(mean, fullMean)`: `mean / fullMean`; `RangeError` for a mean outside 0-255, `Error` ("too dark") when `fullMean` is below `LIGHT_FLOOR_A` (bench-export), since a ratio against a nearly black photo means nothing.
- `CORNERS` (top-left, top-right, bottom-right, bottom-left) and `nextCorner(taps)` (null after four).
- `cornersProblem(corners, w, h)`: a message or null: fewer than 4 taps, not in order (a turn that is not clockwise in image coordinates, so crossed or reversed taps), or a quadrilateral under 1 % of the photo.
- `homographyFromCorners(src, dst)`: the 3x3 (row-major, h33 = 1) mapping four points onto four, by Gauss-Jordan on the 8x8 system; throws "degenerate" for collinear points. `applyHomography(m, x, y)`.
- `rectifiedSize(corners, maxLongEdge)`: the longer of each pair of opposite edges, scaled down so the long side is at most the cap.
- `rectify(frame, corners, size)`: the straightened surface, sampled bilinearly through the homography from the output's pixel centres (corners onto (0,0), (w-1,0), (w-1,h-1), (0,h-1)); samples outside the photo read 0.
- `guideRect(fw, fh, widthPercent, aspect)`: the centred guide frame of a pose, shrunk to fit the frame height.
- `toImagePoint(clientX, clientY, box, iw, ih)`: a tap on an `object-fit: contain` picture in image pixels with pixel centres at integers (half a pixel below the edge coordinate, clamped to [0, size - 1]), the convention the JSON states and `rectify` samples in; null on the letterbox bars.
- `cropFrame(frame, rect)`: a copy of the rectangle, clamped to the frame; `RangeError` when empty.
- `flatFileNames(surface, cls, session)`: `flat-target-s03-busy-<session>.zip` holding `s03-reference.png`, `s03-reference-rectified.png`, `s03-<session>-info.json`, `query(pose, q, bin)` (`s03-w40-t0-q2-b3.png`) and `original(name)` (`s03-original.<ext>`, `.bin` without an extension). The session token keeps two phones, or a cleared progress, that both number from s01 from writing one name twice; only its letters and digits are used, and an empty token leaves the names untagged.
- `ShotInfo`, `FlatInfoInput` and `flatInfo(v)`: the surface JSON, format `flat-target/1`, with surface, class, session token, the original (exists, file), the capture size cap, `capture: "getUserMedia"` (the photos are video frames, not still-camera shots) and `camera` (the stream size when the reference was taken, null after a reload or once the surface's photos were freed), the reference (file, size, a sentence on the coordinates, the four corners named and rounded to 0.01 px, the rectified file and size) and every shot (file, pose, distance, tilt, shot number, full light, grey mean, luma ratio, bin, bin range, size). A null `file` means the photo was in an earlier download, not in this zip.

## Invariants and assumptions

- Image coordinates have y down; corner order is clockwise on screen.
- The JSON carries no time, date or place: only the session token from the page.
- Every input from the page (taps, means, ratios) is validated here; bad values throw or return a problem text rather than produce a wrong file.

## Example

```ts
const bad = cornersProblem(taps, 1024, 768); // null when usable
const size = rectifiedSize(taps, 1024);
const straight = rectify(frame, taps, size);
lightBin(lumaRatio(42, 128)); // "b4"
```

## Tests

`flat-target.test.ts`: every bin bound and the refused ratios, a property test that bins never get brighter as the ratio falls, the luma ratio and its too-dark refusal, the 6 poses and 3 classes, corner order and the named problems, a property test that the homography maps four convex points onto the rectangle, collinear points refused, the rectified size and its cap, rectify cutting an axis-aligned rectangle out unchanged, the guide frame (and a tall surface), a tap on a letterboxed picture, crops, the file names and the JSON with its tags and no time or place.
