# camera-report.ts

## Purpose

What the camera says about itself at a photo, for the desk: whether Chrome on the phone reports a usable focus distance, and the zoom, size and frame rate. The photo test never demands exact distances; it records what the camera reports instead. Read from the track's `getSettings()` and `getCapabilities()` into a flat record that goes on the photo (`PhotoMeta.camera` in `run-plan.ts`), into the frames JSON (`run-zip.ts`) and into one log line (`plan-io.ts`).

## Public API

- `CameraReport`: `Record<string, number | string>`. Numbers: `focusDistance`, `zoom`, `width`, `height`, `frameRate` (the settings) and `focusDistanceMin`, `focusDistanceMax`, `focusDistanceStep`, `zoomMin`, `zoomMax`, `zoomStep` (the capability ranges). Strings: `focusMode` (the setting) and `focusModes` (the capability's choices joined with commas). A field the camera did not give is absent.
- `cameraReport(track: unknown): CameraReport`: the report of a video track; `{}` for anything that is not one.
- `knownCameraReport(v)`: the known fields of a stored report (numbers finite, modes strings); a field this build does not know, or one of the wrong type, is dropped, not the report. `undefined` when `v` is not an object or nothing known is left, so an empty report is stored as absent.
- `cameraReportText(report)`: one log line, for example `focusDistance 0.42 (0.1-10), focusMode continuous (manual,continuous), zoom 1 (1-8), 1920x1080 at 30 fps`; `nothing reported` for an empty report.

## Invariants and defensive measures

- Never throws: a missing method, one that throws, or one that returns something other than an object reads as `{}`.
- Only finite numbers and non-empty strings are kept; a non-string focus mode choice is dropped.
- Only the listed fields are kept, so the device id (`deviceId`, `groupId`) never leaves the phone.

## Example

```ts
const report = cameraReport(stream.getTracks()[0]);
log(`camera at ${shot.id}: ${cameraReportText(report)}`);
```

## Tests

- `camera-report.test.ts`: the fields of a Chrome-like track, the device id left out; missing, throwing and malformed methods and fields; the log line, and `knownCameraReport` keeping the known fields and giving `undefined` for an empty or unknown report.
- `camera-report.property.test.ts`: for any track-like value (methods returning anything, throwing, or missing) the report never throws, reads back unchanged through `knownCameraReport` and has no device id.
