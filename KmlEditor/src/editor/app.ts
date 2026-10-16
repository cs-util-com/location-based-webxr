import * as THREE from 'three';
import {
    createDeleteFeatureCommand,
    createSetDescriptionCommand,
    createSetNameCommand,
    createMoveMarkerCommand,
    createMoveLineVertexCommand,
    createMoveOverlayCommand,
    createRotateOverlayCommand,
    createMoveModelCommand,
    createScaleModelCommand,
    createRotateModelCommand,
} from '../commands';
import {
    IFeatureView,
    IMarkerFeature,
    ILineFeature,
    IGroundOverlayFeature,
    IModelFeature,
} from '../contracts/document-model';
import { IAssetProvider } from '../contracts/kmz-container';
import { IPersistenceService } from '../contracts/persistence';
import { IEditorStore } from '../contracts/store';
import { FeatureId, GeoPosition, LatLonBox, ModelOrientation, ModelScale } from '../contracts/type';
import { createPersistenceService } from '../persistence';
import { RendererFactory } from '../renderers';
import { createEditorStore } from '../store';
import { DesktopScene } from './desktop-scene';
import { FeatureSceneRegistry } from './feature-scene-registry';
import { ReplayHarness } from './replay-harness';

const dummyAssetProvider: IAssetProvider = {
    getAssetUrl: async (href) => href,
    release: () => { },
    getAssetBytes: async () => new Uint8Array(0),
    hasAsset: () => false,
    dispose: () => { },
};

/** Mountable desktop editor with debounced File System Access auto-save persistence. */
export class EditorApp {
    private readonly store: IEditorStore;
    private readonly persistence: IPersistenceService;
    private readonly replayHarness = new ReplayHarness();
    private readonly scene: DesktopScene;
    private readonly registry: FeatureSceneRegistry;
    private readonly list: HTMLUListElement;
    private readonly message: HTMLElement;
    private readonly inspectorContainer: HTMLElement;
    private readonly fileInput: HTMLInputElement;

    // Common fields
    private readonly nameInput: HTMLInputElement;
    private readonly descriptionInput: HTMLTextAreaElement;

    // Dynamic spatial input fields container
    private readonly spatialFieldsContainer: HTMLElement;

    // Action buttons
    private readonly applyButton: HTMLButtonElement;
    private readonly focusButton: HTMLButtonElement;
    private readonly deleteButton: HTMLButtonElement;
    private readonly undoButton: HTMLButtonElement;
    private readonly redoButton: HTMLButtonElement;

    private unsubscribe: (() => void) | null = null;
    private disposed = false;

    public constructor(private readonly host: HTMLElement, store: IEditorStore = createEditorStore()) {
        this.store = store;
        this.persistence = createPersistenceService();
        this.host.replaceChildren();
        injectStyles();

        const shell = document.createElement('div');
        shell.className = 'kml-editor';

        const sidebar = document.createElement('aside');
        const viewport = document.createElement('main');
        viewport.className = 'kml-editor__viewport';

        // Message banner
        this.message = document.createElement('p');
        this.message.className = 'kml-editor__message';
        this.message.setAttribute('role', 'alert');

        // File picker & Auto-save row
        const pickerGroup = document.createElement('div');
        pickerGroup.className = 'kml-editor__card';
        const pickerLabel = document.createElement('label');
        pickerLabel.className = 'kml-editor__section-title';
        pickerLabel.textContent = 'DOCUMENT SOURCE';

        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = '.kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz';
        this.fileInput.style.display = 'none';
        this.fileInput.addEventListener('change', () => { const file = this.fileInput.files?.[0]; if (file) void this.openFile(file); });

        const openBtn = button('Open KML / KMZ File', () => void this.triggerOpen(), 'primary');

        const historyRow = document.createElement('div');
        historyRow.className = 'kml-editor__btn-row';
        this.undoButton = button('Undo ↩', () => this.store.undo());
        this.redoButton = button('Redo ↪', () => this.store.redo());
        historyRow.append(this.undoButton, this.redoButton);
        pickerGroup.append(pickerLabel, openBtn, this.fileInput, historyRow);

        // Feature list section
        const listCard = document.createElement('div');
        listCard.className = 'kml-editor__card';
        const listTitle = document.createElement('label');
        listTitle.className = 'kml-editor__section-title';
        listTitle.textContent = 'FEATURES';
        this.list = document.createElement('ul');
        this.list.className = 'kml-editor__feature-list';
        this.list.setAttribute('aria-label', 'KML features');
        listCard.append(listTitle, this.list);

        // Inspector section
        this.inspectorContainer = document.createElement('div');
        this.inspectorContainer.className = 'kml-editor__card';
        const inspectorTitle = document.createElement('label');
        inspectorTitle.className = 'kml-editor__section-title';
        inspectorTitle.textContent = 'PROPERTY INSPECTOR';

        // General fields
        this.nameInput = document.createElement('input');
        this.nameInput.placeholder = 'Feature name';
        this.descriptionInput = document.createElement('textarea');
        this.descriptionInput.placeholder = 'Feature description';

        // Spatial fields container
        this.spatialFieldsContainer = document.createElement('div');
        this.spatialFieldsContainer.className = 'kml-editor__spatial-fields';

        // Inspector Buttons
        const actionRow = document.createElement('div');
        actionRow.className = 'kml-editor__btn-row';
        this.applyButton = button('Apply properties', () => this.applyProperties(), 'primary');
        this.focusButton = button('Focus in 3D 🎯', () => this.focusSelected());
        this.deleteButton = button('Delete', () => this.deleteSelected(), 'danger');
        actionRow.append(this.applyButton, this.focusButton, this.deleteButton);

        this.inspectorContainer.append(
            inspectorTitle,
            formField('Name', this.nameInput),
            formField('Description', this.descriptionInput),
            this.spatialFieldsContainer,
            actionRow
        );

        // Replay Walk Card (Task 1 phone-free)
        const replayCard = document.createElement('div');
        replayCard.className = 'kml-editor__card';
        const replayTitle = document.createElement('label');
        replayTitle.className = 'kml-editor__section-title';
        replayTitle.textContent = 'REPLAY WALK (TASK 1)';

        const walkSelect = document.createElement('select');
        walkSelect.style.width = '100%';

        const PRESET_WALKS = [
            { label: 'Walk 1 (13:58:24 UTC)', url: '../../fixtures/recordings/2026-06-24_13-58-24utc.zip' },
            { label: 'Walk 2 (13:54:45 UTC)', url: '../../fixtures/recordings/2026-06-24_13-54-45utc.zip' },
            { label: 'Walk 3 (13:56:01 UTC)', url: '../../fixtures/recordings/2026-06-24_13-56-01utc.zip' },
            { label: 'Walk 4 (14:04:36 UTC)', url: '../../fixtures/recordings/2026-06-24_14-04-36utc.zip' },
            { label: 'Walk 5 (14:09:28 UTC)', url: '../../fixtures/recordings/2026-06-24_14-09-28utc.zip' },
            { label: 'Walk 6 (14:12:35 UTC)', url: '../../fixtures/recordings/2026-06-24_14-12-35utc.zip' },
            { label: 'Walk 7 (14:19:00 UTC)', url: '../../fixtures/recordings/2026-06-24_14-19-00utc.zip' },
            { label: 'InfoWalk 1 (13:52:34 UTC)', url: '../../fixtures/recordings/InfoWalk/2026-06-24_13-52-34utc.zip' },
            { label: 'InfoWalk 2 (13:56:51 UTC)', url: '../../fixtures/recordings/InfoWalk/2026-06-24_13-56-51utc.zip' },
            { label: 'InfoWalk 3 (14:04:16 UTC)', url: '../../fixtures/recordings/InfoWalk/2026-06-24_14-04-16utc.zip' },
            { label: 'InfoWalk 4 (14:08:42 UTC)', url: '../../fixtures/recordings/InfoWalk/2026-06-24_14-08-42utc.zip' },
            { label: 'InfoWalk 5 (14:12:17 UTC)', url: '../../fixtures/recordings/InfoWalk/2026-06-24_14-12-17utc.zip' },
            { label: 'InfoWalk 6 (14:17:01 UTC)', url: '../../fixtures/recordings/InfoWalk/2026-06-24_14-17-01utc.zip' },
        ];

        PRESET_WALKS.forEach((w) => {
            const opt = document.createElement('option');
            opt.value = w.url;
            opt.textContent = w.label;
            walkSelect.appendChild(opt);
        });

        const customWalkInput = document.createElement('input');
        customWalkInput.type = 'file';
        customWalkInput.accept = '.zip';
        customWalkInput.style.display = 'none';

        const customWalkBtn = button('Upload Local Walk .ZIP', () => customWalkInput.click());

        const replayStatus = document.createElement('span');
        replayStatus.style.fontSize = '0.8rem';
        replayStatus.style.color = '#8ea1c0';
        replayStatus.textContent = 'Status: Idle';

        const loadAndPlayRecording = async (source: string | File) => {
            this.replayHarness.attach(this.scene, this.store.geoBridge);
            replayStatus.textContent = 'Loading recording...';
            try {
                let buf: ArrayBuffer;
                if (typeof source === 'string') {
                    const res = await fetch(source);
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    buf = await res.arrayBuffer();
                } else {
                    buf = await source.arrayBuffer();
                }
                const count = await this.replayHarness.loadZip(buf);
                replayStatus.textContent = `Loaded ${count} samples`;
                this.replayHarness.play(2);
            } catch {
                replayStatus.textContent = 'Failed to load recording ZIP';
            }
        };

        customWalkInput.addEventListener('change', () => {
            const file = customWalkInput.files?.[0];
            if (file) void loadAndPlayRecording(file);
        });

        walkSelect.addEventListener('change', () => {
            this.replayHarness.stop();
            void loadAndPlayRecording(walkSelect.value);
        });

        const replayRow = document.createElement('div');
        replayRow.className = 'kml-editor__btn-row';

        const playBtn = button('Play Replay ▶', async () => {
            if (this.replayHarness.getSamples().length === 0) {
                await loadAndPlayRecording(walkSelect.value);
            } else {
                this.replayHarness.play(2);
            }
        });

        const pauseBtn = button('Pause ❚❚', () => {
            this.replayHarness.pause();
        });

        this.replayHarness.onStateChange((st) => {
            replayStatus.textContent = `Status: ${st}`;
        });

        this.replayHarness.onSampleChange((_sample, idx) => {
            replayStatus.textContent = `Step ${idx + 1}/${this.replayHarness.getSamples().length}`;
        });

        replayRow.append(playBtn, pauseBtn);
        replayCard.append(
            replayTitle,
            formField('Walk Recording', walkSelect),
            customWalkBtn,
            customWalkInput,
            replayRow,
            replayStatus
        );

        sidebar.append(pickerGroup, this.message, listCard, this.inspectorContainer, replayCard);
        shell.append(sidebar, viewport);
        this.host.appendChild(shell);

        this.scene = new DesktopScene(viewport);
        this.registry = new FeatureSceneRegistry(this.scene.featureRoot, new RendererFactory());
        this.scene.renderer.domElement.addEventListener('pointerdown', (event: PointerEvent) => this.pick(event));

        // Zoom Slider Overlay
        const zoomControl = document.createElement('div');
        zoomControl.className = 'kml-editor__zoom-control';
        zoomControl.innerHTML = `<span style="font-weight:bold;font-size:0.9rem;">+</span><input type="range" min="0.3" max="4.7" step="0.01" value="2.5" class="kml-editor__zoom-slider" title="Zoom in / out"><span style="font-weight:bold;font-size:0.9rem;">−</span>`;
        viewport.appendChild(zoomControl);

        const zoomSlider = zoomControl.querySelector('input') as HTMLInputElement;
        zoomSlider.addEventListener('input', () => {
            const val = Number(zoomSlider.value);
            const dist = Math.pow(10, 5.0 - val);
            this.scene.setZoomDistance(dist);
        });

        this.scene.controls.addEventListener('change', () => {
            const dist = this.scene.getZoomDistance();
            const logVal = Math.log10(Math.max(2, dist));
            zoomSlider.value = (5.0 - logVal).toFixed(2);
        });

        this.unsubscribe = this.store.subscribe((state) => {
            const doc = (this.store as any).document;
            const features = doc ? doc.getFeatures() : [];
            const container = (this.store as any).container;
            const assets = container ? container.getAssetProvider() : dummyAssetProvider;

            this.undoButton.disabled = !state.canUndo;
            this.redoButton.disabled = !state.canRedo;

            void this.render(features, assets, state.selectedFeatureId);
        });

        this.persistence.onStatusChange((status) => {
            if (status === 'saving') {
                this.setMessage('Auto-saving changes to disk…');
            } else if (status === 'saved') {
                this.setMessage('All changes auto-saved to file.');
            } else if (status === 'error') {
                this.setMessage('Auto-save failed.');
            }
        });
    }

    public async triggerOpen(): Promise<void> {
        if (this.persistence.hasNativeFileAccess) {
            this.setMessage('Opening file handle…');
            try {
                const container = await this.persistence.open();
                await (this.store as any).loadContainer(container);
                this.setMessage(`Opened '${this.persistence.fileName}'. All edits auto-save directly to disk.`);
            } catch (err) {
                if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) return;
                // Fallback to standard input picker
                this.fileInput.click();
            }
        } else {
            this.fileInput.click();
        }
    }

    public async openFile(file: File): Promise<void> {
        if (!/\.kml|\.kmz$/i.test(file.name)) { this.setMessage('Choose a .kml or .kmz file.'); return; }
        this.setMessage('Loading…');
        try {
            const container = await this.persistence.open(file);
            await (this.store as any).loadContainer(container);
            this.setMessage(`Loaded '${file.name}'. All edits automatically auto-save.`);
        }
        catch (error) { this.setMessage(error instanceof Error ? error.message : 'Could not load the file.'); }
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.unsubscribe?.(); this.unsubscribe = null;
        this.replayHarness.dispose();
        this.registry.dispose();
        this.scene.dispose();
        this.persistence.dispose();
        this.host.replaceChildren();
    }

    private async render(features: readonly IFeatureView[], assets: IAssetProvider, selected: FeatureId | null): Promise<void> {
        if (this.disposed) { this.list.replaceChildren(); return; }
        try { await this.registry.reconcile(features, assets, this.store.geoBridge); }
        catch (error) { this.setMessage(error instanceof Error ? `Preview warning: ${error.message}` : 'Preview warning.'); }

        this.list.replaceChildren(...features.map((feature) => {
            const item = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `kml-editor__feature-item ${feature.id === selected ? 'selected' : ''}`;
            btn.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight:600; font-size:0.85rem;">${feature.name || '(unnamed)'}</span>
                    <span class="kml-editor__badge ${feature.type}">${feature.type}</span>
                </div>
                <div style="font-size:0.7rem; color:#8a99ad; margin-top:0.2rem; font-family:monospace;">ID: ${feature.id}</div>
            `;
            btn.addEventListener('click', () => this.store.selectFeature(feature.id === selected ? null : feature.id));
            item.appendChild(btn);
            return item;
        }));

        const active = selected ? features.find((feature) => feature.id === selected) ?? null : null;
        this.nameInput.value = active?.name ?? '';
        this.descriptionInput.value = active?.description ?? '';

        this.updateSpatialInputs(active);
    }

    private updateSpatialInputs(feature: IFeatureView | null): void {
        this.spatialFieldsContainer.replaceChildren();

        if (!feature) {
            this.nameInput.disabled = true;
            this.descriptionInput.disabled = true;
            this.applyButton.disabled = true;
            this.focusButton.disabled = true;
            this.deleteButton.disabled = true;
            return;
        }

        this.nameInput.disabled = false;
        this.descriptionInput.disabled = false;
        this.applyButton.disabled = false;
        this.focusButton.disabled = false;
        this.deleteButton.disabled = false;

        const sectionLabel = document.createElement('label');
        sectionLabel.className = 'kml-editor__section-title';
        sectionLabel.textContent = `GEOMETRY / SPATIAL (${feature.type.toUpperCase()})`;
        this.spatialFieldsContainer.appendChild(sectionLabel);

        if (feature.type === 'marker') {
            const f = feature as IMarkerFeature;
            const pos = f.position || { lon: 0, lat: 0, alt: 0 };

            const lonInput = numberInput('lon', pos.lon, 0.000001);
            const latInput = numberInput('lat', pos.lat, 0.000001);
            const altInput = numberInput('alt', pos.alt, 0.1);

            this.spatialFieldsContainer.append(
                formField('Longitude (°)', lonInput),
                formField('Latitude (°)', latInput),
                formField('Altitude (m)', altInput)
            );
        } else if (feature.type === 'line') {
            const f = feature as ILineFeature;
            const coords = f.coordinates || [];

            coords.forEach((coord, i) => {
                const row = document.createElement('div');
                row.className = 'kml-editor__vertex-row';
                const label = document.createElement('span');
                label.textContent = `V${i + 1}`;
                label.style.fontWeight = 'bold';
                label.style.fontSize = '0.75rem';

                const lonInput = numberInput(`v${i}_lon`, coord.lon, 0.000001);
                const latInput = numberInput(`v${i}_lat`, coord.lat, 0.000001);
                const altInput = numberInput(`v${i}_alt`, coord.alt, 0.1);

                row.append(label, lonInput, latInput, altInput);
                this.spatialFieldsContainer.appendChild(row);
            });
        } else if (feature.type === 'ground-overlay') {
            const f = feature as IGroundOverlayFeature;
            const box = f.latLonBox || { north: 0, south: 0, east: 0, west: 0, rotation: 0 };

            const nInput = numberInput('north', box.north, 0.000001);
            const sInput = numberInput('south', box.south, 0.000001);
            const eInput = numberInput('east', box.east, 0.000001);
            const wInput = numberInput('west', box.west, 0.000001);
            const rotInput = numberInput('rotation', box.rotation || 0, 1);
            const altInput = numberInput('altitude', f.altitude || 0, 0.1);

            this.spatialFieldsContainer.append(
                formField('North (°)', nInput),
                formField('South (°)', sInput),
                formField('East (°)', eInput),
                formField('West (°)', wInput),
                formField('Rotation (°)', rotInput),
                formField('Altitude (m)', altInput)
            );
        } else if (feature.type === 'model') {
            const f = feature as IModelFeature;
            const loc = f.location || { lon: 0, lat: 0, alt: 0 };
            const ori = f.orientation || { heading: 0, tilt: 0, roll: 0 };
            const scale = f.scale || { x: 1, y: 1, z: 1 };

            const lonInput = numberInput('lon', loc.lon, 0.000001);
            const latInput = numberInput('lat', loc.lat, 0.000001);
            const altInput = numberInput('alt', loc.alt, 0.1);

            const headingInput = numberInput('heading', ori.heading, 1);
            const tiltInput = numberInput('tilt', ori.tilt, 1);
            const rollInput = numberInput('roll', ori.roll, 1);

            const scaleXInput = numberInput('scaleX', scale.x, 0.1);
            const scaleYInput = numberInput('scaleY', scale.y, 0.1);
            const scaleZInput = numberInput('scaleZ', scale.z, 0.1);

            this.spatialFieldsContainer.append(
                formField('Longitude (°)', lonInput),
                formField('Latitude (°)', latInput),
                formField('Altitude (m)', altInput),
                formField('Heading (°)', headingInput),
                formField('Tilt (°)', tiltInput),
                formField('Roll (°)', rollInput),
                formField('Scale X', scaleXInput),
                formField('Scale Y', scaleYInput),
                formField('Scale Z', scaleZInput)
            );
        }
    }

    private pick(event: PointerEvent): void {
        const canvas = this.scene.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(pointer, this.scene.camera);
        const hit = raycaster.intersectObjects(this.scene.featureRoot.children, true)[0];
        this.store.selectFeature(hit ? this.registry.findFeatureId(hit.object) : null);
    }

    private applyProperties(): void {
        const selected = this.store.selectedFeatureId;
        if (!selected) {
            this.setMessage('Select a feature first to edit properties.');
            return;
        }
        const doc = (this.store as any).document;
        const feature = doc ? doc.getFeatureById(selected) : null;
        if (!feature) {
            this.setMessage('Selected feature not found in document.');
            return;
        }

        let updated = false;

        // Common text edits
        if (this.nameInput.value !== feature.name) {
            this.store.executeCommand(createSetNameCommand(selected, this.nameInput.value));
            updated = true;
        }
        if (this.descriptionInput.value !== feature.description) {
            this.store.executeCommand(createSetDescriptionCommand(selected, this.descriptionInput.value));
            updated = true;
        }

        // Spatial edits by type
        if (feature.type === 'marker') {
            const lonEl = this.spatialFieldsContainer.querySelector('input[name="lon"]') as HTMLInputElement;
            const latEl = this.spatialFieldsContainer.querySelector('input[name="lat"]') as HTMLInputElement;
            const altEl = this.spatialFieldsContainer.querySelector('input[name="alt"]') as HTMLInputElement;

            if (lonEl && latEl && altEl) {
                const lon = parseFloat(lonEl.value);
                const lat = parseFloat(latEl.value);
                const alt = parseFloat(altEl.value);

                const orig = (feature as IMarkerFeature).position;
                if (lon !== orig.lon || lat !== orig.lat || alt !== orig.alt) {
                    const targetGeo: GeoPosition = { lon, lat, alt };
                    const worldPos = this.store.geoBridge.geoToWorld(targetGeo, 'absolute');
                    this.store.executeCommand(createMoveMarkerCommand(selected, worldPos));
                    updated = true;
                }
            }
        } else if (feature.type === 'line') {
            const lineFeature = feature as ILineFeature;
            lineFeature.coordinates.forEach((coord, i) => {
                const lonEl = this.spatialFieldsContainer.querySelector(`input[name="v${i}_lon"]`) as HTMLInputElement;
                const latEl = this.spatialFieldsContainer.querySelector(`input[name="v${i}_lat"]`) as HTMLInputElement;
                const altEl = this.spatialFieldsContainer.querySelector(`input[name="v${i}_alt"]`) as HTMLInputElement;

                if (lonEl && latEl && altEl) {
                    const lon = parseFloat(lonEl.value);
                    const lat = parseFloat(latEl.value);
                    const alt = parseFloat(altEl.value);

                    if (lon !== coord.lon || lat !== coord.lat || alt !== coord.alt) {
                        const targetGeo: GeoPosition = { lon, lat, alt };
                        const worldPos = this.store.geoBridge.geoToWorld(targetGeo, 'absolute');
                        this.store.executeCommand(createMoveLineVertexCommand(selected, i, worldPos));
                        updated = true;
                    }
                }
            });
        } else if (feature.type === 'ground-overlay') {
            const overlay = feature as IGroundOverlayFeature;
            const nEl = this.spatialFieldsContainer.querySelector('input[name="north"]') as HTMLInputElement;
            const sEl = this.spatialFieldsContainer.querySelector('input[name="south"]') as HTMLInputElement;
            const eEl = this.spatialFieldsContainer.querySelector('input[name="east"]') as HTMLInputElement;
            const wEl = this.spatialFieldsContainer.querySelector('input[name="west"]') as HTMLInputElement;
            const rotEl = this.spatialFieldsContainer.querySelector('input[name="rotation"]') as HTMLInputElement;
            const altEl = this.spatialFieldsContainer.querySelector('input[name="altitude"]') as HTMLInputElement;

            if (nEl && sEl && eEl && wEl && rotEl && altEl) {
                const north = parseFloat(nEl.value);
                const south = parseFloat(sEl.value);
                const east = parseFloat(eEl.value);
                const west = parseFloat(wEl.value);
                const rotation = parseFloat(rotEl.value);
                const altitude = parseFloat(altEl.value);

                const newBox: LatLonBox = { north, south, east, west, rotation };
                if (
                    north !== overlay.latLonBox.north ||
                    south !== overlay.latLonBox.south ||
                    east !== overlay.latLonBox.east ||
                    west !== overlay.latLonBox.west ||
                    altitude !== overlay.altitude
                ) {
                    this.store.executeCommand(createMoveOverlayCommand(selected, newBox, altitude, overlay.altitudeMode));
                    updated = true;
                }
                if (rotation !== (overlay.latLonBox.rotation || 0)) {
                    this.store.executeCommand(createRotateOverlayCommand(selected, rotation));
                    updated = true;
                }
            }
        } else if (feature.type === 'model') {
            const model = feature as IModelFeature;
            const lonEl = this.spatialFieldsContainer.querySelector('input[name="lon"]') as HTMLInputElement;
            const latEl = this.spatialFieldsContainer.querySelector('input[name="lat"]') as HTMLInputElement;
            const altEl = this.spatialFieldsContainer.querySelector('input[name="alt"]') as HTMLInputElement;

            const hEl = this.spatialFieldsContainer.querySelector('input[name="heading"]') as HTMLInputElement;
            const tEl = this.spatialFieldsContainer.querySelector('input[name="tilt"]') as HTMLInputElement;
            const rEl = this.spatialFieldsContainer.querySelector('input[name="roll"]') as HTMLInputElement;

            const sxEl = this.spatialFieldsContainer.querySelector('input[name="scaleX"]') as HTMLInputElement;
            const syEl = this.spatialFieldsContainer.querySelector('input[name="scaleY"]') as HTMLInputElement;
            const szEl = this.spatialFieldsContainer.querySelector('input[name="scaleZ"]') as HTMLInputElement;

            if (lonEl && latEl && altEl) {
                const lon = parseFloat(lonEl.value);
                const lat = parseFloat(latEl.value);
                const alt = parseFloat(altEl.value);
                if (lon !== model.location.lon || lat !== model.location.lat || alt !== model.location.alt) {
                    const newLoc: GeoPosition = { lon, lat, alt };
                    this.store.executeCommand(createMoveModelCommand(selected, newLoc));
                    updated = true;
                }
            }

            if (hEl && tEl && rEl) {
                const heading = parseFloat(hEl.value);
                const tilt = parseFloat(tEl.value);
                const roll = parseFloat(rEl.value);
                if (heading !== model.orientation.heading || tilt !== model.orientation.tilt || roll !== model.orientation.roll) {
                    const newOri: ModelOrientation = { heading, tilt, roll };
                    this.store.executeCommand(createRotateModelCommand(selected, newOri));
                    updated = true;
                }
            }

            if (sxEl && syEl && szEl) {
                const x = parseFloat(sxEl.value);
                const y = parseFloat(syEl.value);
                const z = parseFloat(szEl.value);
                if (x !== model.scale.x || y !== model.scale.y || z !== model.scale.z) {
                    const newScale: ModelScale = { x, y, z };
                    this.store.executeCommand(createScaleModelCommand(selected, newScale));
                    updated = true;
                }
            }
        }

        if (updated) {
            this.persistence.notifyChange();
            this.setMessage('Feature properties updated. Auto-saving to file…');
        } else {
            this.setMessage('No property changes detected.');
        }
    }

    private focusSelected(): void {
        const selected = this.store.selectedFeatureId;
        if (!selected) {
            this.setMessage('Select a feature first to focus.');
            return;
        }
        const object = this.registry.getObject(selected);
        if (object) {
            this.scene.focusOn(object);
            this.setMessage('Focused camera on selected feature.');
        } else {
            this.setMessage('Feature object not found in 3D scene.');
        }
    }

    private deleteSelected(): void {
        const selected = this.store.selectedFeatureId;
        if (!selected) return;
        this.store.executeCommand(createDeleteFeatureCommand(selected));
        this.persistence.notifyChange();
        this.store.selectFeature(null);
    }

    private setMessage(value: string): void { this.message.textContent = value; }
}

export function mountEditor(host: HTMLElement): EditorApp { return new EditorApp(host); }

function button(label: string, onClick: () => void, variant: 'normal' | 'primary' | 'danger' = 'normal'): HTMLButtonElement {
    const result = document.createElement('button');
    result.type = 'button';
    result.className = `kml-editor__btn ${variant !== 'normal' ? 'btn-' + variant : ''}`;
    result.textContent = label;
    result.addEventListener('click', onClick);
    return result;
}

function formField(label: string, element: HTMLElement): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'kml-editor__form-group';
    const lbl = document.createElement('label');
    lbl.className = 'kml-editor__form-label';
    lbl.textContent = label;
    group.append(lbl, element);
    return group;
}

function numberInput(name: string, value: number, step: number = 0.000001): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.name = name;
    input.value = String(value);
    input.step = String(step);
    input.className = 'kml-editor__input';
    return input;
}

function injectStyles(): void {
    if (document.getElementById('kml-editor-styles')) return;
    const style = document.createElement('style');
    style.id = 'kml-editor-styles';
    style.textContent = `
        .kml-editor {
            display: grid;
            grid-template-columns: 22rem minmax(0, 1fr);
            height: 100%;
            background: #0d0e15;
            color: #f3f4f6;
            font-family: Outfit, Inter, system-ui, sans-serif;
        }
        .kml-editor aside {
            padding: 1.25rem;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 1rem;
            border-right: 1px solid rgba(255, 255, 255, 0.08);
            background: rgba(20, 21, 33, 0.85);
        }
        .kml-editor__viewport { position: relative; min-width: 0; min-height: 0; }
        
        .kml-editor__card {
            background: rgba(26, 28, 44, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 1rem;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }

        .kml-editor__section-title {
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: #00b894;
            font-weight: 700;
        }

        .kml-editor__message {
            font-size: 0.8rem;
            color: #ffd08a;
            margin: 0;
            min-height: 1.2rem;
        }

        .kml-editor__feature-list {
            padding: 0;
            margin: 0;
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 0.35rem;
            max-height: 180px;
            overflow-y: auto;
        }

        .kml-editor__feature-item {
            width: 100%;
            text-align: left;
            padding: 0.5rem 0.75rem;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 8px;
            color: #e9edf5;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .kml-editor__feature-item:hover {
            background: rgba(0, 184, 148, 0.1);
            border-color: rgba(0, 184, 148, 0.3);
        }
        .kml-editor__feature-item.selected {
            background: rgba(0, 184, 148, 0.2);
            border-color: #00b894;
        }

        .kml-editor__badge {
            font-size: 0.65rem;
            text-transform: uppercase;
            padding: 0.15rem 0.4rem;
            border-radius: 4px;
            font-weight: 700;
        }
        .kml-editor__badge.marker { background: rgba(0, 184, 148, 0.25); color: #55efc4; }
        .kml-editor__badge.line { background: rgba(9, 132, 227, 0.25); color: #74b9ff; }
        .kml-editor__badge.ground-overlay { background: rgba(253, 203, 110, 0.25); color: #ffeaa7; }
        .kml-editor__badge.model { background: rgba(162, 155, 254, 0.25); color: #a29bfe; }

        .kml-editor__form-group {
            display: flex;
            flex-direction: column;
            gap: 0.3rem;
        }

        .kml-editor__form-label {
            font-size: 0.75rem;
            color: #9ca3af;
            font-weight: 600;
        }

        .kml-editor input[type="text"],
        .kml-editor input[type="number"],
        .kml-editor textarea {
            background: rgba(10, 11, 18, 0.8);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 6px;
            padding: 0.45rem 0.6rem;
            color: #f3f4f6;
            font-family: inherit;
            font-size: 0.82rem;
        }
        .kml-editor input:focus,
        .kml-editor textarea:focus {
            outline: none;
            border-color: #00b894;
            box-shadow: 0 0 0 2px rgba(0, 184, 148, 0.2);
        }

        .kml-editor__vertex-row {
            display: grid;
            grid-template-columns: 2rem 1fr 1fr 1fr;
            gap: 0.3rem;
            align-items: center;
            margin-bottom: 0.3rem;
        }

        .kml-editor__btn-row {
            display: flex;
            gap: 0.4rem;
            flex-wrap: wrap;
        }

        .kml-editor__btn {
            flex: 1;
            padding: 0.5rem 0.75rem;
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.06);
            color: #f3f4f6;
            font-size: 0.8rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .kml-editor__btn:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.12);
        }
        .kml-editor__btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        .kml-editor__btn.btn-primary {
            background: #00b894;
            border-color: #00b894;
            color: #0d0e15;
        }
        .kml-editor__btn.btn-primary:hover:not(:disabled) {
            background: #55efc4;
        }
        .kml-editor__btn.btn-danger {
            background: rgba(214, 48, 49, 0.2);
            border-color: rgba(214, 48, 49, 0.4);
            color: #ff7675;
        }
        .kml-editor__btn.btn-danger:hover:not(:disabled) {
            background: #d63031;
            color: #fff;
        }

        .kml-editor__zoom-control {
            position: absolute;
            right: 1.25rem;
            top: 50%;
            transform: translateY(-50%);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.5rem;
            background: rgba(16, 19, 26, 0.85);
            border: 1px solid #31405a;
            padding: 0.8rem 0.5rem;
            border-radius: 24px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            backdrop-filter: blur(8px);
            z-index: 10;
            color: #9ca3af;
            user-select: none;
        }
        .kml-editor__zoom-slider {
            writing-mode: bt-lr;
            -webkit-appearance: slider-vertical;
            appearance: slider-vertical;
            width: 18px;
            height: 180px;
            cursor: pointer;
        }
    `;
    document.head.appendChild(style);
}
