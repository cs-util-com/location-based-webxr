# Demos starten
```bash
pnpm run dev:geo-bridge
```
demo ar-scene als host öffnen:
```bash
npx vite --host
```
# How to use Key APIs for record/replay of Task 1 walks for e2e tests

## Diagnose AR marker drift

Start the scene on the phone over the LAN:

```bash
npm run dev:ar-scene -- --host 0.0.0.0
```

Start AR, wait for the marker to settle, then tap **Save AR log**. Repeat this from a fresh launch at the same physical location and save the second log. Each JSON file records the first accepted GPS fix, session anchor, compass readings, marker-local coordinates, and the `arWorldGroup` alignment matrix. The same log is also available live as `window.__arSceneDiagnostics.getLog()`.

Interpret the first difference in this order:

- Different `gps` or `anchor`: the phone selected a different initial GPS fix. Repeat after GPS accuracy is stable, or use a fixed/replayed GPS trace.
- Same anchor but different `markerLocal`: the geographic projection, KML coordinate, altitude mode, or heading input differs.
- Same marker-local position but different `arWorldGroupMatrix` or `markerWorld`: SLAM/orientation alignment differs between launches. Repeat with the same startup movement and wait for tracking to settle.

For automated comparisons, import `compareDiagnosticLogs()` from `src/ar-scene` or run it in the browser console with two parsed logs; it returns `gps-anchor`, `marker-local`, `ar-alignment`, or `no-divergence`.

# How to use Key APIs for record/replay of Task 1 walks for e2e tests

Following APIs provide needed interfaces between the Task 1 walk files and the KML/KMZ Editor:
- exportSessionAsZip(sessionHandle, { contributors? }) converts walk session file into a ZIP-blob (zip-file not yet stored in memory but in RAM)
- replayRecording(store, blob) feeds a ZIP-blob into the KML editors store where it can be read/used for actions
- loadActionsFromZip(blob) / loadEntriesFromSubdir(blob, subdir) draws actions from walk file
