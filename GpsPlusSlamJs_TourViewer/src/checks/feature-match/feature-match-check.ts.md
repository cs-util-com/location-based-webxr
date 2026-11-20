# feature-match-check.ts

## Purpose

The page module of `feature-match-check.html`: finds the form's elements, runs the camera, builds the method list from the choices, runs `runBenchmark`, and renders the table, the log and the report.

## Public API

- `startFeatureMatchCheck(root = document)`: wires the page. Throws `feature-match-check: missing <selector>` if the HTML lacks an element it needs.

## Invariants and assumptions

- All measuring lives in `bench-run.ts`; this file only touches the DOM and browser APIs (`getUserMedia`, `performance`, `navigator.gpu`, `navigator.userAgentData`, the clipboard).
- Camera frames are captured from the rear camera (`facingMode: environment`) and kept at most 1280 px on the long side.
- Every failure (camera refused, nothing chosen, a method that fails, a page error, an unhandled rejection) becomes an `ERROR ...` log line and goes into the report; the Run button is re-enabled in a `finally`.
- Resource timing's buffer is raised to 1000 entries so a long run keeps the download sizes.
- No app state: the page is a measurement tool with one transient run at a time (captures and the stream are local to the page's closure).

## Example

```html
<script type="module">
  import { startFeatureMatchCheck } from "./src/checks/feature-match/feature-match-check.ts";
  startFeatureMatchCheck(document);
</script>
```

## Tests

`playwright-tests/feature-match-check.spec.js` (stubbed SIFT, success and failure paths). The browser-only code has no unit test.
