# index.html — UI Designer Reference

## Overview

Full-screen AR recording app. The user goes through **setup** (folder selection, scenario, permissions) → **AR session** (live camera + HUD) → **recording** (GPS/AR data capture with ref-point marking) → **session summary** (stats, map, download). A separate **replay** flow lets users load and play back previously recorded sessions in 3D.

The HTML defines a static skeleton; ~16 TypeScript modules in `src/ui/` populate and animate it at runtime.

---

## External Dependencies

All loaded in `<head>` — removal breaks functionality.

| Dependency | Tag | URL / Path | Purpose |
|---|---|---|---|
| Leaflet CSS | `<link>` | `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css` (SRI hash) | Session summary map + replay preview map |
| Tailwind CSS | `<script>` | `https://cdn.tailwindcss.com` | Utility-first styling (loaded as script for JIT compilation) |
| App styles | `<link>` | `/styles/app.css` | Behavioral CSS (z-index, pointer-events, safe-area) + log/legend colors |

### Meta Tags (contracts)

| Tag | Value | Why |
|---|---|---|
| `viewport` | `width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover` | AR requires no-zoom + full notch area on iOS |
| `charset` | `UTF-8` | Emoji in button labels (📍, ⛶, ✕) |
| Favicon | Inline SVG data URI (red circle) | No external request needed |

---

## Contractual Anchors

### Element IDs

Every ID below is referenced by TypeScript code. Removing or renaming any of them will crash the app (via `getRequiredElement` throwing) or silently break functionality (via `getElementById` returning `null`).

#### HUD Overlay

| ID | Tag | Used by | JS interaction |
|---|---|---|---|
| `hud` | `div` | `app.css` | Overlay container (pointer-events: none) |
| `status` | `div` | `hud.ts` | Clickable — toggles log panel. `cursor: pointer` in CSS |
| `status-text` | `span` | `hud.ts` | `.textContent` set to current status message |
| `gps-info` | `div` | `hud.ts` | `.hidden` toggled based on GPS availability |
| `gps-accuracy` | `span` | `hud.ts` | `.textContent` set to accuracy meters |
| `ar-info` | `div` | `hud.ts` | `.hidden` toggled based on AR tracking |
| `ar-tracking` | `span` | `hud.ts` | `.textContent` set to tracking state |
| `sync-info` | `div` | `hud.ts` | `.hidden` toggled based on sync activity |
| `sync-status` | `span` | `hud.ts` | `.textContent` + color classes (`text-green-400`, `text-yellow-400`) |
| `frame-count-info` | `div` | `hud.ts` | `.hidden` toggled during recording |
| `frame-count` | `span` | `hud.ts` | `.textContent` set to frame counter |

#### Log Panel

| ID | Tag | Used by | JS interaction |
|---|---|---|---|
| `log-panel` | `div` | `log-panel.ts` | `.hidden` toggled to show/hide. CSS: `display: flex` (overrides Tailwind `.hidden`) |
| `log-panel-header` | `div` | — | Static structure (safe-area padding from CSS) |
| `log-panel-close` | `button` | `log-panel.ts` | Click handler to hide panel |
| `log-panel-content` | `div` | `log-panel.ts` | `.innerHTML` cleared; child `<div>` elements appended per log entry |

#### Recording Controls

| ID | Tag | Used by | JS interaction |
|---|---|---|---|
| `controls` | `div` | `app.css` | Overlay container (pointer-events: none, z-index: 10) |
| `btn-start` | `button` | `hud.ts` | `.hidden` toggled; click starts recording |
| `btn-stop` | `button` | `hud.ts` | `.hidden` toggled; click stops recording. `aria-label="Stop Recording"` |
| `recording-indicator` | `span` | `hud.ts` | `.hidden` toggled; pulsing red dot. `aria-label="Recording in progress"` |
| `btn-ref-point` | `button` | `hud.ts` | `.hidden` toggled; click opens ref-point picker. `aria-label="Mark Reference Point"` |
| `btn-map-zoom-in` | `button` | `hud.ts` | Click handler for map zoom. `aria-label="Map Zoom In"` |
| `btn-map-zoom-out` | `button` | `hud.ts` | Click handler for map zoom. `aria-label="Map Zoom Out"` |
| `btn-map` | `button` | `hud.ts` | Click toggles live map overlay. `aria-label="Toggle Map"` |

#### Replay Controls

| ID | Tag | Used by | JS interaction |
|---|---|---|---|
| `replay-controls` | `div` | `replay-ui.ts`, `app.css` | `.hidden` toggled. Overlay with pointer-events model |
| `btn-replay-play-pause` | `button` | `replay-ui.ts` | Click toggles play/pause |
| `replay-progress` | `span` | `replay-ui.ts` | `.textContent` set to frame progress |
| `btn-camera-toggle` | `button` | `replay-ui.ts` | Click toggles orbit/track camera. `aria-label="Toggle Camera Mode"` |
| `btn-map-zoom-in-replay` | `button` | `replay-ui.ts` | Map zoom. `aria-label="Map Zoom In"` |
| `btn-map-zoom-out-replay` | `button` | `replay-ui.ts` | Map zoom. `aria-label="Map Zoom Out"` |
| `btn-map-toggle-replay` | `button` | `replay-ui.ts` | Map toggle. `aria-label="Toggle Map"` |

#### Replay Legend

| ID | Tag | Used by | JS interaction |
|---|---|---|---|
| `replay-legend` | `div` | `replay-ui.ts` | `.hidden` toggled during replay |

#### Session Summary Panel

| ID | Tag | Used by | JS interaction |
|---|---|---|---|
| `session-summary-panel` | `div` | `session-summary.ts` | `.hidden` toggled. z-index: 50 overlay |
| `summary-duration` | `div` | `session-summary.ts` | `.textContent` set (e.g., "00:02:15") |
| `summary-gps-count` | `div` | `session-summary.ts` | `.textContent` set to GPS event count |
| `summary-ref-points` | `div` | `session-summary.ts` | `.textContent` set to ref-point count |
| `summary-images` | `div` | `session-summary.ts` | `.textContent` set to image count |
| `summary-depth-samples` | `div` | `session-summary.ts` | `.textContent` set to depth sample count |
| `summary-failed-writes` | `div` | `session-summary.ts` | `.textContent` set; parent `.summary-row` gets `.warning` class if > 0 |
| `summary-zip-size` | `div` | `session-summary.ts` | `.textContent` set to formatted file size |
| `summary-zip-files` | `div` | `session-summary.ts` | `.textContent` set to file count |
| `summary-first-gps` | `span` | `session-summary.ts` | `.textContent` set to first GPS coordinate |
| `summary-last-gps` | `span` | `session-summary.ts` | `.textContent` set to last GPS coordinate |
| `summary-distance` | `span` | `session-summary.ts` | `.textContent` set to distance traveled |
| `summary-map-container` | `div` | `summary-map.ts` | Leaflet map initialized here; expand/collapse buttons appended dynamically |
| `summary-errors` | `pre` | `session-summary.ts` | `.textContent` set to error/warning log |
| `btn-share-session` | `button` | `session-summary.ts` | `.hidden` toggled; click triggers Web Share API |
| `btn-view-logs` | `button` | `session-summary.ts` | Click opens log panel |
| `btn-new-recording` | `button` | `session-summary.ts` | Click triggers soft reset to setup screen |

#### Setup Modal

| ID | Tag | Used by | JS interaction |
|---|---|---|---|
| `setup-modal` | `div` | `hud.ts`, `replay-handlers.ts` | `.hidden` toggled. z-index: 50 |
| `setup-title` | `h1` | — | Static |
| `btn-settings` | `button` | `hud.ts` | Click opens settings modal. `aria-label="Recording Settings"` |
| `help-section` | `details` | `hud.ts` | `.open` toggled programmatically |
| `help-section-content` | `div` | — | Static content |
| `storage-setup` | `div` | — | Container for the storage setup UI (save location + optional folder import) |
| `btn-choose-save` | `button` | `hud.ts` | Click opens save file picker. The **only mandatory** storage step (D5). `aria-label` set |
| `save-status` | `p` | `hud.ts` | `.textContent` set to save location path |
| `folder-import-section` | `details` | `hud.ts` | **Optional** folder-import step, collapsed by default; `.open` toggled by `setFolderImportExpanded` (auto-expanded when the chosen scenario has no OPFS ref points, and in replay mode) |
| `folder-import-hint` | `p` | `hud.ts` | One-line recovery hint shown above the folder button when auto-expanded |
| `btn-open-folder` | `button` | `hud.ts` | Inside `folder-import-section`. Click opens File System Access API. `aria-label` set |
| `folder-status` | `p` | `hud.ts` | `.textContent` set to selected folder path |
| `folder-import-progress` | `div` | `hud.ts` | D2 (2026-07-05): container of the determinate folder-import indexing progress display (`data-testid="folder-import-progress"`); `.hidden` toggled by `setFolderImportProgress`. Exposes `role="progressbar"` with static `aria-valuemin`/`aria-valuemax` and `aria-labelledby` pointing at the text label; `hud.ts` drives `aria-valuenow` (removed when hidden) so screen readers can announce progress (PR #168 review) |
| `folder-import-progress-text` | `p` | `hud.ts` | Text label above the bar ("Recovering reference points… x / y recordings" / ✓ end-state summary) |
| `folder-import-progress-bar` | `div` | `hud.ts` | Inner bar; `style.width` set to the completion percentage |
| `scenario-select` | `select` | `hud.ts` | `<option>` elements appended dynamically; `change` listener |
| `new-scenario-section` | `div` | `hud.ts` | `.hidden` toggled + opacity animation (CSS transition contract) |
| `new-scenario-name` | `input` | `hud.ts` | `.value` read for custom scenario name; pre-filled with `Default Scenario` (UX 2026-05-03) so users can tap Enter AR without typing when no existing scenarios are found |
| `session-notes` | `textarea` | `main.ts`, `hud.ts` | `.value` read; `.disabled` toggled |
| `permission-section` | `div` | — | Container for permission rows |
| `perm-filestorage` | `div` | `hud.ts` | Permission row container |
| `perm-filestorage-status` | `span` | `hud.ts` | `.textContent` set to status emoji. `aria-live="polite"` |
| `perm-webxr` | `div` | `hud.ts` | Permission row container |
| `perm-webxr-status` | `span` | `hud.ts` | `.textContent` set. `aria-live="polite"` |
| `perm-gps` | `div` | `hud.ts` | Permission row container |
| `perm-gps-status` | `span` | `hud.ts` | `.textContent` set. `aria-live="polite"` |
| `perm-camera` | `div` | `hud.ts` | Permission row container |
| `perm-camera-status` | `span` | `hud.ts` | `.textContent` set. `aria-live="polite"` |
| `btn-request-permissions` | `button` | `hud.ts` | `.hidden` toggled; click requests device permissions. `aria-label` set |
| `permission-error` | `p` | `hud.ts` | `.hidden` toggled; `.textContent` set to error messages |
| `btn-enter-ar` | `button` | `hud.ts` | `.disabled` toggled; click enters WebXR session |
| `enter-ar-hint` | `p` | `hud.ts` | `.textContent` set to explain why Enter AR is disabled |
| `webxr-warning` | `p` | `hud.ts` | `.hidden` toggled when WebXR not supported |

#### Replay Setup (inside setup modal)

| ID | Tag | Used by | JS interaction |
|---|---|---|---|
| `replay-setup` | `div` | `replay-ui.ts` | `.hidden` toggled |
| `replay-scenario-select` | `select` | `replay-ui.ts` | `<option>` elements appended dynamically |
| `replay-session-list` | `div` | `replay-ui.ts` | Child `<div>` elements appended per session |
| `replay-preview-map` | `div` | `replay-handlers.ts`, `preview-map.ts` | `.hidden` toggled; Leaflet map initialized here |
| `btn-start-replay` | `button` | `replay-ui.ts` | Click starts replay playback |
| `replay-hint` | `p` | `replay-ui.ts` | `.textContent` set to hint messages |

#### Reference Point Picker

| ID | Tag | Used by | JS interaction |
|---|---|---|---|
| `ref-point-picker-modal` | `div` | `main.ts`, `ref-point-picker.ts` | `.hidden` toggled; `.innerHTML` set by `createRefPointPickerHtml()` |

#### Settings Modal

| ID | Tag | Used by | JS interaction |
|---|---|---|---|
| `settings-modal` | `div` | `settings-modal.ts` | `.hidden` toggled |
| `btn-settings-close` | `button` | `settings-modal.ts` | Click hides modal |
| `images-enabled` | `input` (checkbox) | `settings-modal.ts` | `.checked` read/set |
| `images-interval` | `input` (range) | `settings-modal.ts` | `.value` read/set; `input` event |
| `images-interval-value` | `span` | `settings-modal.ts` | `.textContent` set (e.g., "2.0s") |
| `images-quality` | `input` (range) | `settings-modal.ts` | `.value` read/set; `input` event |
| `images-quality-value` | `span` | `settings-modal.ts` | `.textContent` set (e.g., "75%") |
| `images-resolution-divisor` | `input` (range) | `settings-modal.ts` | `.value` read/set; `input` event |
| `images-resolution-divisor-value` | `span` | `settings-modal.ts` | `.textContent` set (e.g., "2×2") |
| `depth-enabled` | `input` (checkbox) | `settings-modal.ts` | `.checked` read/set |
| `depth-interval` | `input` (range) | `settings-modal.ts` | `.value` read/set |
| `depth-interval-value` | `span` | `settings-modal.ts` | `.textContent` set |
| `depth-grid` | `input` (range) | `settings-modal.ts` | `.value` read/set |
| `depth-grid-value` | `span` | `settings-modal.ts` | `.textContent` set |
| `btn-settings-reset` | `button` | `settings-modal.ts` | Click resets all to defaults |
| `btn-settings-save` | `button` | `settings-modal.ts` | Click saves and closes |

---

### Data Attributes

| Attribute | On | Selector in JS | Module | Purpose |
|---|---|---|---|---|
| `data-replay-speed="{n}"` | `<button>` (7 speed presets) | `.replay-live-speed` buttons read `dataset.replaySpeed` | `replay-ui.ts` | Replay speed multiplier values (0.1, 0.2, 0.5, 1, 2, 5, 10) |
| `data-legend-entry` | `<span>` (3 legend items) | `querySelectorAll('[data-legend-entry]')` | `replay-ui.ts` (tests) | Identifies color legend entries (GPS, Fused VIO, Alignment) |
| `data-session-index` | `<div>` (dynamic) | `querySelectorAll('[data-session-index]')` | `replay-ui.ts` | Set dynamically on session list entries; read on click for selection |

---

### CSS Class Selectors (JS-referenced)

These class names are queried by JavaScript — they are **not** purely visual.

| Class | Selector in JS | Module | Purpose |
|---|---|---|---|
| `replay-live-speed` | `document.querySelectorAll('.replay-live-speed')` | `replay-ui.ts` | Identifies all replay speed preset buttons for event delegation |
| `summary-row` | `.closest('.summary-row')` | `session-summary.ts` | Parent container traversal for failed-writes warning styling |
| `log-entry` | — (added programmatically) | `log-panel.ts` | Applied to every log entry `<div>` |
| `log-entry-debug` | `.log-entry-debug` | `log-panel.ts` | Log severity class (styled in `app.css`) |
| `log-entry-info` | `.log-entry-info` | `log-panel.ts` | Log severity class |
| `log-entry-warn` | `.log-entry-warn` | `log-panel.ts` | Log severity class |
| `log-entry-error` | `.log-entry-error` | `log-panel.ts` | Log severity class |
| `legend-color-raw-gps` | — | `app.css` | Legend dot color (styled in CSS, class in HTML) |
| `legend-color-fused-path` | — | `app.css` | Legend dot color |
| `warning` | `.classList.add('warning')` | `session-summary.ts` | Applied to `.summary-row` when failed writes > 0 |
| `hidden` | `.classList.add/remove/toggle('hidden')` | Multiple modules | Visibility control (must resolve to `display: none`) |

---

### Tailwind Classes Programmatically Added by JS

These Tailwind utility classes are added/removed by TypeScript at runtime. A redesign must include them in the Tailwind configuration or replace with equivalent behavior.

| Class | Module | When/why |
|---|---|---|
| `text-green-400` | `hud.ts` | Sync success / permission granted status |
| `text-yellow-400` | `hud.ts` | Sync pending / permission partial status |
| `text-red-400` | `hud.ts` | Permission denied / error status |
| `bg-gray-700/50` | `session-summary.ts` | Failed-writes row background highlight |
| `bg-blue-600` | `replay-ui.ts` | Selected session entry highlight |
| `hover:bg-gray-600` | `replay-ui.ts` | Replaced on selected session entry |
| `opacity-0`, `opacity-100` | `hud.ts` | Fade animation on `new-scenario-section` |
| `relative` | `summary-map.ts` | Added to map container for expand/collapse button positioning |

---

### ARIA Contracts

`aria-live="polite"` on all five `perm-*-status` spans — the JS sets `.textContent` on these and screen readers announce changes. Must be preserved.

`aria-label` on all interactive buttons (see Element IDs table above) — the JS does not set these dynamically, but they are accessibility contracts the designer should preserve.

---

### DOM Structure Constraints

| Constraint | Module | Reason |
|---|---|---|
| `#summary-failed-writes` must be inside a `.summary-row` ancestor | `session-summary.ts` | Uses `.closest('.summary-row')` to find parent row for warning styling |
| `#summary-map-container` must exist as a container for Leaflet | `summary-map.ts` | Leaflet initialized inside; expand/collapse buttons appended as children |
| `#ref-point-picker-modal` must be an empty shell | `ref-point-picker.ts` | Content injected via `.innerHTML` at runtime |
| `#app` is the root container | `replay-handlers.ts` | Used as Three.js renderer parent via `getElementById('app')` |
| `#hud > *` children must be interactive | `app.css` | `pointer-events: none` on `#hud`, `auto` on children |
| `#controls > *` and `#replay-controls > *` same pattern | `app.css` | Pointer-events passthrough model |

---

### CSS Behavioral Contracts

These CSS rules in `styles/app.css` are **functional**, not just visual. JS relies on them.

| Rule | Contract |
|---|---|
| `#hud { pointer-events: none; z-index: 10 }` + `#hud > * { pointer-events: auto }` | Allows taps to pass through to AR canvas while HUD children remain interactive |
| `#controls, #replay-controls { pointer-events: none; z-index: 10 }` + children `auto` | Same passthrough model for control overlays |
| `#log-panel { z-index: 60; display: flex }` | Log panel overlays everything except modals. Must override `.hidden { display: none }` |
| `#setup-modal, #session-summary-panel { z-index: 50 }` | Modals appear above canvas/HUD but below log panel |
| `#app { position: relative }` | Establishes positioning context for all `position: absolute` overlays |
| `html, body { overflow: hidden }` | Prevents scrollbars on full-screen AR canvas |
| `#hud { padding-top: calc(1rem + env(safe-area-inset-top)) }` | Mobile notch avoidance |
| `new-scenario-section` opacity transition | `hud.ts` reads `getComputedStyle().transitionDuration` to time hide after fade-out |
| `#status { cursor: pointer }` | Indicates status bar is clickable (opens log panel) |

---

### Hidden/Visibility Toggling

Elements that get `.hidden` toggled at runtime:

| Element | Shown when | Module |
|---|---|---|
| `gps-info` | GPS data available during recording | `hud.ts` |
| `ar-info` | AR tracking active | `hud.ts` |
| `sync-info` | Sync in progress | `hud.ts` |
| `frame-count-info` | Recording active | `hud.ts` |
| `log-panel` | User taps status bar | `log-panel.ts` |
| `btn-start` | AR ready, not yet recording | `hud.ts` |
| `btn-stop` | Recording in progress | `hud.ts` |
| `recording-indicator` | Recording in progress | `hud.ts` |
| `btn-ref-point` | Recording in progress | `hud.ts` |
| `replay-controls` | Replay active | `replay-ui.ts` |
| `replay-legend` | Replay active | `replay-ui.ts` |
| `session-summary-panel` | After recording stops | `session-summary.ts` |
| `setup-modal` | Hidden during AR/recording/replay | `hud.ts`, `replay-handlers.ts` |
| `new-scenario-section` | "New scenario" selected in dropdown | `hud.ts` |
| `btn-request-permissions` | Permissions not yet granted | `hud.ts` |
| `permission-error` | Permission request failed | `hud.ts` |
| `webxr-warning` | WebXR not supported | `hud.ts` |
| `replay-setup` | Session folder loaded with recordings | `replay-ui.ts` |
| `replay-preview-map` | Session selected in replay list | `replay-handlers.ts` |
| `ref-point-picker-modal` | Mark Point button clicked | `ref-point-picker.ts` |
| `settings-modal` | Settings button clicked | `settings-modal.ts` |
| `btn-share-session` | Web Share API available | `session-summary.ts` |

---

## Dynamically Created DOM

These elements do **not** exist in the static HTML — they are created by TypeScript at runtime. The designer cannot style them via HTML alone.

| Component | Module | What's created | Where attached |
|---|---|---|---|
| Toast container | `toast.ts` | `<div id="toast-container">` carrying the message text — **only while a message is showing**, attached on show and removed on hide (2026-08-24) | `#app` (the AR DOM-overlay root), falling back to `document.body` |
| Confirm dialog | `confirm-dialog.ts` | Backdrop `<div>` + dialog `<div>` with `<p>` + buttons | `document.body` |
| Ref-point picker content | `ref-point-picker.ts` | Full form HTML (input, dropdown, buttons) via `createRefPointPickerHtml()` | `#ref-point-picker-modal` (innerHTML) |
| Summary map controls | `summary-map.ts` | Expand (⛶) and collapse (✕) buttons with `data-testid` | `#summary-map-container` |
| Log entries | `log-panel.ts` | `<div class="log-entry log-entry-{level}">` | `#log-panel-content` |
| Scenario options | `hud.ts` | `<option>` elements | `#scenario-select` |
| Replay session entries | `replay-ui.ts` | `<div data-session-index="{n}">` | `#replay-session-list` |
| Replay scenario options | `replay-ui.ts` | `<option>` elements | `#replay-scenario-select` |
| Download links | `session-summary.ts`, `zip-export.ts` | Temporary `<a>` elements (click + remove) | `document.body` |

---

## UI Sections (current layout)

### HUD Overlay (`#hud`)
- **Appearance**: Semi-transparent black box in top-left with status text, GPS accuracy, AR tracking, sync status, frame count.
- **Visible**: Always (during AR/recording/replay). Hidden during setup.
- **Owner**: `hud.ts`

### Log Panel (`#log-panel`)
- **Appearance**: Top 40% of screen, dark background, scrollable log entries color-coded by severity.
- **Visible**: When user taps status bar. z-index 60 (above everything).
- **Owner**: `log-panel.ts`

### Recording Controls (`#controls`)
- **Appearance**: Bottom of screen. Start button (green), stop button (red with pulsing dot), ref-point button, map controls pill.
- **Visible**: During AR ready and recording states.
- **Owner**: `hud.ts`

### Replay Controls (`#replay-controls`)
- **Appearance**: Bottom of screen. Play/pause, 7 speed preset buttons, camera toggle, map controls.
- **Visible**: During replay playback.
- **Owner**: `replay-ui.ts`

### Replay Legend (`#replay-legend`)
- **Appearance**: Small pill showing 3 color indicators (GPS = yellow, Fused VIO = cyan, Alignment = red).
- **Visible**: During replay.
- **Owner**: `replay-ui.ts`

### Session Summary (`#session-summary-panel`)
- **Appearance**: Centered overlay with rounded card. Grid of 8 stat boxes, GPS validation, Leaflet map, error log, action buttons.
- **Visible**: After recording stops.
- **Owner**: `session-summary.ts`, `summary-map.ts`

### Setup Modal (`#setup-modal`)
- **Appearance**: Full-screen scrollable form. Folder selection, scenario picker, notes textarea, 5 permission rows, Enter AR button. Collapsible help section. Replay section appears when session folder has recordings.
- **Visible**: On page load and after soft reset.
- **Owner**: `hud.ts`, `replay-ui.ts`

### Reference Point Picker (`#ref-point-picker-modal`)
- **Appearance**: Modal overlay with input field, landmark dropdown, confirm/cancel buttons.
- **Visible**: When user clicks Mark Point during recording.
- **Owner**: `ref-point-picker.ts` (content generated dynamically)

### Settings Modal (`#settings-modal`)
- **Appearance**: Overlay with sliders and checkboxes for image capture and depth sampling parameters.
- **Visible**: When user clicks settings gear in setup modal.
- **Owner**: `settings-modal.ts`

---

## State Machine & Visibility

```
┌─────────┐   Enter AR   ┌──────────┐   Start   ┌───────────┐   Stop   ┌─────────┐
│  SETUP  │ ────────────> │ AR_READY │ ────────> │ RECORDING │ ───────> │ SUMMARY │
└─────────┘               └──────────┘           └───────────┘          └─────────┘
     ^                         │                      │                      │
     │          Back           │       Back (confirm)  │      New Recording  │
     └─────────────────────────┘<─────────────────────┘<─────────────────────┘

                               ┌──────────┐
     SETUP (replay section) ──>│  REPLAY  │──> SETUP (on complete)
                               └──────────┘
```

| Screen | Visible elements | Hidden elements |
|---|---|---|
| **SETUP** | `setup-modal` | `hud`, `controls`, `replay-controls`, `replay-legend`, `session-summary-panel` |
| **AR_READY** | `hud`, `controls` (`btn-start` visible) | `setup-modal`, `btn-stop`, `recording-indicator`, `btn-ref-point` |
| **RECORDING** | `hud` (all info blocks), `controls` (`btn-stop`, `recording-indicator`, `btn-ref-point` visible) | `setup-modal`, `btn-start` |
| **SUMMARY** | `session-summary-panel` | `setup-modal`, `controls`, `hud` info blocks |
| **REPLAY** | `replay-controls`, `replay-legend`, `hud` | `setup-modal`, `controls`, `session-summary-panel` |

---

## Tests

- Unit tests for each UI module are colocated: `src/ui/*.test.ts`
- Tests reconstruct the HTML skeleton via `innerHTML` in `beforeEach` — they serve as executable documentation of which IDs and data attributes each module requires
- Key test files: `hud.test.ts`, `session-summary.test.ts`, `replay-ui.test.ts`, `log-panel.test.ts`, `settings-modal.test.ts`, `ref-point-picker.test.ts`, `toast.test.ts`, `confirm-dialog.test.ts`, `summary-map.test.ts`
