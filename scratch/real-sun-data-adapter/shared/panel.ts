// THROWAWAY browser host. GPS and timers belong here, never in a model.
import { startGpsWatch, stopGpsWatch } from '../../../GpsPlusSlamJs_AppFramework/src/sensors/gps.ts';
import { createDriver, type Variant } from './drivers.ts';
import { recordedPair, startMs, syntheticFix, pairs } from './fixtures.ts';
import type { Inputs } from './contracts.ts';
import './style.css';

const variant = document.body.dataset.variant as Variant;
const title = { a: 'A · Commands / immediate edits', b: 'B · Configuration / draft and apply', c: 'C · Pure snapshot / host wrapper' }[variant];
document.title = `${title} — throwaway`;
document.querySelector('#app')!.innerHTML = `
  <nav><a href="/">All prototypes</a> · <a href="/a-commands/">A</a> · <a href="/b-configuration/">B</a> · <a href="/c-snapshot/">C</a></nav>
  <p class="warning">THROWAWAY PROTOTYPE · Not a production component · Synthetic fixtures are not Task 1 recordings</p>
  <h1>${title}</h1>
  <p>${variant === 'b' ? 'Edit both drafts, then apply them together. Selected sources stay unchanged until Apply; active live inputs keep updating.' : 'Source switches and edits apply immediately. Recorded pairs always apply atomically.'}</p>
  <section class="grid">
    <fieldset><legend>Location selection</legend>
      <label>Location source <select id="location-mode"><option value="live">Live framework feed</option><option value="fixed">Fixed location</option></select></label>
      <label>Latitude (degrees) <input id="latitude" type="number" step="any" value="52.52"></label>
      <label>Longitude (degrees) <input id="longitude" type="number" step="any" value="13.405"></label>
    </fieldset>
    <fieldset><legend>Time selection</legend>
      <label>Time source <select id="time-mode"><option value="real">Real clock</option><option value="fixed">Fixed instant</option></select></label>
      <label>Absolute ISO time (UTC or explicit offset) <input id="instant" value="2026-06-21T12:00:00Z" spellcheck="false"></label>
      <label>UTC time slider · 21 June 2026 · minutes <input id="slider" type="range" min="0" max="1439" step="1" value="720"></label>
    </fieldset>
  </section>
  <p id="draft-status" role="status">No pending drafts</p>
  <p id="input-error" role="alert"></p>
  <button id="apply" ${variant === 'b' ? '' : 'hidden'}>Apply both drafts atomically</button>
  <section><h2>Host input harness</h2>
    <button id="gps-start">Start real framework GPS</button><button id="gps-stop">Stop real GPS</button>
    <button id="synthetic">Deliver synthetic live-feed fix</button><button id="clear">Clear live cache</button>
    <p id="feed">Live feed: no input yet</p>
    <button id="refresh">Refresh selected inputs</button><button id="test-clock">Use synthetic real clock</button>
    <button id="advance">Advance test clock 1 hour</button><span id="clock">Clock dependency: device wall clock</span>
  </section>
  <section><h2>Synthetic atomic replay ${variant === 'c' ? '· snapshot stepping' : ''}</h2>
    <button id="previous">Previous pair</button><button id="next">Next pair</button><button id="repeat">Repeat pair</button>
    <span id="fixture">No pair applied</span>
  </section>
  <section><h2>Effective state</h2><p id="effective"></p><p id="publications"></p><pre id="state" aria-live="polite"></pre></section>
  <button id="dispose">Dispose host + model</button><button id="reset">Recreate with defaults</button>
`;

const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const label = (id: string, value: string) => { document.getElementById(id)!.textContent = value; };
let testClock: number | null = null;
let model = createDriver(variant, () => testClock ?? Date.now());
let publicationCount = 0;
let fixtureIndex = -1;
let feedIndex = 0;
let gpsActive = false;
let disposed = false;
let timer: ReturnType<typeof setInterval> | undefined;

function draw() {
  const state = model.getState();
  const selected = model.getInputs();
  label('effective', `Selected: ${selected.location.mode} location + ${selected.time.mode} time`);
  label('publications', `Publications: ${publicationCount}`);
  label('state', JSON.stringify(state.status === 'ready' ? {
    ...state, utc: new Date(state.sample.sunTimeMs).toISOString(),
  } : state, null, 2));
  clearInterval(timer);
  timer = undefined;
  if (!disposed && selected.time.mode === 'real') timer = setInterval(() => model.refresh(), 30000);
}
let unsubscribe = model.subscribe(() => { publicationCount++; draw(); });

function selectionFromControls(): Inputs {
  const text = input('instant').value.trim();
  const hasOffset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text);
  const instant = new Date(hasOffset ? text : NaN);
  label('input-error', input('time-mode').value === 'fixed' && !Number.isFinite(instant.getTime())
    ? 'Enter a valid ISO instant with Z or an explicit offset. No fallback to real time.' : '');
  return {
    location: input('location-mode').value === 'live' ? { mode: 'live' } : {
      mode: 'fixed', latitudeDeg: input('latitude').value === '' ? NaN : Number(input('latitude').value),
      longitudeDeg: input('longitude').value === '' ? NaN : Number(input('longitude').value),
    },
    time: input('time-mode').value === 'real' ? { mode: 'real' } : { mode: 'fixed', instant },
  };
}
function edit(which: 'location' | 'time') {
  const selected = selectionFromControls();
  if (variant === 'b') {
    label('draft-status', 'Unapplied drafts — selected sources below have not changed');
  } else {
    // A exercises source-specific commands; C replaces a complete snapshot.
    if (variant === 'a') {
      if (which === 'location') model.setLocationSource(selected.location);
      else model.setTimeSource(selected.time);
    } else model.setInputs({ ...model.getInputs(), [which]: selected[which] });
    label('draft-status', 'Applied immediately');
  }
}
input('location-mode').addEventListener('change', () => edit('location'));
input('time-mode').addEventListener('change', () => edit('time'));
for (const id of ['latitude', 'longitude']) input(id).addEventListener('input', () => {
  input('location-mode').value = 'fixed'; edit('location');
});
input('instant').addEventListener('input', () => { input('time-mode').value = 'fixed'; edit('time'); });
input('slider').addEventListener('input', () => {
  input('instant').value = new Date(startMs + Number(input('slider').value) * 60000).toISOString();
  input('time-mode').value = 'fixed'; edit('time');
});
input('apply').onclick = () => { model.setInputs(selectionFromControls()); label('draft-status', 'Drafts applied atomically'); };
input('refresh').onclick = () => model.refresh();
function stopGps() { if (gpsActive) stopGpsWatch(); gpsActive = false; }
input('gps-start').onclick = () => {
  if (disposed) return;
  if (!navigator.geolocation) { label('feed', 'Real GPS unavailable in this browser'); return; }
  stopGps(); gpsActive = true;
  label('feed', 'Real GPS: awaiting permission/fix');
  startGpsWatch((fix) => {
    label('feed', `Real framework GPS: ${fix.lat}, ${fix.lon}`);
    model.setGpsPosition(fix);
  }, (error) => label('feed', `Real GPS error: ${error.message}`));
};
input('gps-stop').onclick = () => { stopGps(); label('feed', 'Real GPS stopped; latest cache retained'); };
input('synthetic').onclick = () => {
  if (disposed) return;
  stopGps();
  const fix = syntheticFix(feedIndex++ % pairs.length);
  label('feed', `SYNTHETIC live-feed input: ${fix.lat}, ${fix.lon} — not real GPS`);
  model.setGpsPosition(fix);
};
input('clear').onclick = () => { model.clearLiveLocation(); label('feed', 'Live cache cleared'); };
input('test-clock').onclick = () => {
  testClock = startMs + 12 * 3600000; label('clock', `SYNTHETIC clock: ${new Date(testClock).toISOString()}`); model.refresh();
};
input('advance').onclick = () => {
  testClock = (testClock ?? startMs + 12 * 3600000) + 3600000;
  label('clock', `SYNTHETIC clock: ${new Date(testClock).toISOString()}`); model.refresh();
};
function applyPair(index: number) {
  if (disposed) return;
  fixtureIndex = (index + pairs.length) % pairs.length;
  const pair = pairs[fixtureIndex]!;
  input('location-mode').value = 'fixed'; input('time-mode').value = 'fixed';
  input('latitude').value = String(pair.latitudeDeg); input('longitude').value = String(pair.longitudeDeg);
  input('instant').value = new Date(pair.ms).toISOString();
  input('slider').value = String((pair.ms - startMs) / 60000);
  label('input-error', ''); label('draft-status', 'Recorded pair applied atomically; drafts replaced');
  label('fixture', `SYNTHETIC pair ${fixtureIndex + 1}/${pairs.length}`);
  model.setInputs(recordedPair(fixtureIndex));
}
input('next').onclick = () => applyPair(fixtureIndex + 1);
input('previous').onclick = () => applyPair(fixtureIndex < 0 ? pairs.length - 1 : fixtureIndex - 1);
input('repeat').onclick = () => applyPair(Math.max(0, fixtureIndex));
function cleanup() {
  disposed = true; stopGps(); clearInterval(timer); timer = undefined;
  model.dispose(); unsubscribe();
}
input('dispose').onclick = () => { cleanup(); label('feed', 'Host disposed; GPS and timer stopped'); };
input('reset').onclick = () => {
  cleanup(); disposed = false; testClock = null; publicationCount = 0; fixtureIndex = -1; feedIndex = 0;
  model = createDriver(variant, () => testClock ?? Date.now());
  unsubscribe = model.subscribe(() => { publicationCount++; draw(); });
  input('location-mode').value = 'live'; input('time-mode').value = 'real';
  label('draft-status', 'No pending drafts'); label('input-error', '');
  label('feed', 'Live feed: no input yet'); label('clock', 'Clock dependency: device wall clock');
  label('fixture', 'No pair applied'); draw();
};
document.addEventListener('visibilitychange', () => {
  if (!disposed && !document.hidden && model.getInputs().time.mode === 'real') model.refresh();
});
window.addEventListener('pagehide', cleanup);
draw();
