# globe-device.js

- Purpose: the device block of the globe lab's exports, for both the
  frame-hitch recorder (`globe-perf.js`, DEC-PERF-1) and the Debug panel
  (`globe-debug.js`, DEC-G6-6). One implementation (DEC-H3), moved out of
  `globe-perf.js` unchanged.
- Public API: `deviceBlock({ renderer, params, relief, extra })` -> plain
  strings, numbers and booleans:
  - the user agent, the GPU vendor and renderer (where the browser tells),
    the device pixel ratio, the viewport and the drawing buffer;
  - the build: the host and path (a preview's host names its branch), and
    the hash;
  - the extensions that matter here: parallel shader compile, float-linear
    and the GPU timer query;
  - device memory and core count;
  - `extra` (the recorder adds its long-animation-frame support and its
    refresh interval), then every page flag as `flag.<name>`.
- Tests: through the two exports' browser tests (the recorder's smoke and
  the fast tier's Debug check); it reads only the browser, so it has no
  `node --test` of its own.
