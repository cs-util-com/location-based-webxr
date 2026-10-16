import { createDeleteFeatureCommand, createSetDescriptionCommand, createSetNameCommand } from '../commands';
import { IKmlDocument } from '../contracts/document-model';
import { IPersistenceService, SaveStatus } from '../contracts/persistence';
import { IEditorStore, EditorState } from '../contracts/store';
import { FeatureId } from '../contracts/type';


export class ArHud {
    private element: HTMLElement | null = null;
    private trackingBadge: HTMLElement | null = null;
    private saveBadge: HTMLElement | null = null;
    private diagBadge: HTMLElement | null = null;
    private arToggleBtn: HTMLButtonElement | null = null;
    private isArRunning = false;
    private undoBtn: HTMLButtonElement | null = null;
    private redoBtn: HTMLButtonElement | null = null;
    private featurePanel: HTMLElement | null = null;
    private nameInput: HTMLInputElement | null = null;
    private descInput: HTMLTextAreaElement | null = null;
    private fileInput: HTMLInputElement | null = null;

    private storeUnsubscribe: (() => void) | null = null;
    private saveUnsubscribe: (() => void) | null = null;

    public constructor(
        private readonly container: HTMLElement,
        private readonly store: IEditorStore,
        private readonly persistence: IPersistenceService,
        private readonly getDocument: () => IKmlDocument | null,
        private readonly onOpenFile: (file: File) => void,
        private readonly onStartAr: () => void,
        private readonly onStopAr: () => void,
        private readonly onDownloadDiagnostics: () => void
    ) {}

    public mount(): HTMLElement {
        if (this.element) return this.element;

        const hud = document.createElement('div');
        hud.className = 'ar-hud';

        // Hidden file input
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = '.kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz';
        this.fileInput.style.display = 'none';
        this.fileInput.addEventListener('change', () => {
            const file = this.fileInput?.files?.[0];
            if (file) {
                this.onOpenFile(file);
            }
        });
        hud.appendChild(this.fileInput);

        // Top Bar (Status + Open File + AR Launch Button)
        const topBar = document.createElement('div');
        topBar.className = 'ar-hud__top-bar';

        const statusGroup = document.createElement('div');
        statusGroup.className = 'ar-hud__status-group';

        this.trackingBadge = document.createElement('span');
        this.trackingBadge.className = 'ar-hud__badge ar-hud__badge--searching';
        this.trackingBadge.textContent = 'READY';

        this.saveBadge = document.createElement('span');
        this.saveBadge.style.fontSize = '0.8rem';
        this.saveBadge.style.color = '#94a3b8';
        this.saveBadge.textContent = 'No File';

        this.diagBadge = document.createElement('span');
        this.diagBadge.style.fontSize = '0.75rem';
        this.diagBadge.style.color = '#00e5ff';
        this.diagBadge.style.fontFamily = 'monospace';
        this.diagBadge.textContent = '';

        statusGroup.append(this.trackingBadge, this.saveBadge, this.diagBadge);

        const actionsGroup = document.createElement('div');
        actionsGroup.style.display = 'flex';
        actionsGroup.style.gap = '0.5rem';

        const openBtn = document.createElement('button');
        openBtn.className = 'ar-hud__button ar-hud__button--secondary';
        openBtn.textContent = '📂 Open File';
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.fileInput?.click();
        });

        const diagnosticsBtn = document.createElement('button');
        diagnosticsBtn.className = 'ar-hud__button ar-hud__button--secondary';
        diagnosticsBtn.textContent = 'Save AR log';
        diagnosticsBtn.title = 'Download GPS, marker, and alignment diagnostics';
        diagnosticsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onDownloadDiagnostics();
        });

        this.arToggleBtn = document.createElement('button');
        this.arToggleBtn.className = 'ar-hud__button';
        this.arToggleBtn.textContent = 'Start AR';
        this.arToggleBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!this.isArRunning) {
                this.arToggleBtn!.disabled = true;
                this.arToggleBtn!.textContent = 'Starting…';
                try {
                    await this.onStartAr();
                } catch (err) {
                    console.error('[ArHud] Error starting AR:', err);
                } finally {
                    this.arToggleBtn!.disabled = false;
                }
            } else {
                await this.onStopAr();
            }
        });

        actionsGroup.append(openBtn, diagnosticsBtn, this.arToggleBtn);
        topBar.append(statusGroup, actionsGroup);

        // Feature Editing Panel
        this.featurePanel = document.createElement('div');
        this.featurePanel.className = 'ar-hud__panel';
        this.featurePanel.style.display = 'none';

        const nameField = document.createElement('div');
        nameField.className = 'ar-hud__field';
        const nameLabel = document.createElement('label');
        nameLabel.className = 'ar-hud__label';
        nameLabel.textContent = 'Feature Name';
        this.nameInput = document.createElement('input');
        this.nameInput.className = 'ar-hud__input';
        nameField.append(nameLabel, this.nameInput);

        const descField = document.createElement('div');
        descField.className = 'ar-hud__field';
        const descLabel = document.createElement('label');
        descLabel.className = 'ar-hud__label';
        descLabel.textContent = 'Description';
        this.descInput = document.createElement('textarea');
        this.descInput.className = 'ar-hud__textarea';
        descField.append(descLabel, this.descInput);

        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '0.5rem';

        const applyBtn = document.createElement('button');
        applyBtn.className = 'ar-hud__button';
        applyBtn.textContent = 'Save Changes';
        applyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.applyFeatureEdits();
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'ar-hud__button ar-hud__button--danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteSelectedFeature();
        });

        const closeBtn = document.createElement('button');
        closeBtn.className = 'ar-hud__button ar-hud__button--secondary';
        closeBtn.textContent = 'Deselect';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.store.selectFeature(null);
        });

        btnRow.append(applyBtn, deleteBtn, closeBtn);
        this.featurePanel.append(nameField, descField, btnRow);

        // Bottom Bar (Undo / Redo / Export)
        const bottomBar = document.createElement('div');
        bottomBar.className = 'ar-hud__bottom-bar';

        this.undoBtn = document.createElement('button');
        this.undoBtn.className = 'ar-hud__button ar-hud__button--secondary';
        this.undoBtn.textContent = 'Undo';
        this.undoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.store.undo();
        });

        this.redoBtn = document.createElement('button');
        this.redoBtn.className = 'ar-hud__button ar-hud__button--secondary';
        this.redoBtn.textContent = 'Redo';
        this.redoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.store.redo();
        });

        bottomBar.append(this.undoBtn, this.redoBtn);

        hud.append(topBar, this.featurePanel, bottomBar);
        this.container.append(hud);
        this.element = hud;

        this.subscribe();
        return hud;
    }

    public updateTrackingState(state: string): void {
        if (!this.trackingBadge) return;
        this.trackingBadge.className = `ar-hud__badge ar-hud__badge--${state}`;
        this.trackingBadge.textContent = state.toUpperCase();

        this.isArRunning = state === 'running';
        this.trackingBadge.hidden = this.isArRunning;

        if (this.arToggleBtn) {
            if (state === 'running') {
                this.arToggleBtn.textContent = 'Exit AR';
                this.arToggleBtn.className = 'ar-hud__button ar-hud__button--secondary';
                this.arToggleBtn.disabled = false;
            } else if (state === 'starting') {
                this.arToggleBtn.textContent = 'Starting AR…';
                this.arToggleBtn.disabled = true;
            } else {
                this.arToggleBtn.textContent = 'Start AR';
                this.arToggleBtn.className = 'ar-hud__button';
                this.arToggleBtn.disabled = false;
            }
        }
    }

    public updateDiagnosticInfo(text: string): void {
        if (this.diagBadge) {
            this.diagBadge.textContent = text;
        }
    }

    public updateFileStatus(text: string): void {
        if (this.saveBadge) {
            this.saveBadge.textContent = text;
            this.saveBadge.style.color = '#2ecc71';
        }
    }

    public updateLoadedFile(fileName: string | null, featureCount?: number): void {
        if (this.saveBadge) {
            const featureSuffix = typeof featureCount === 'number' ? ` (${featureCount} features)` : '';
            this.saveBadge.textContent = fileName
                ? `Loaded ${fileName}${featureSuffix}`
                : 'No file loaded';
            this.saveBadge.title = this.saveBadge.textContent;
            this.saveBadge.style.color = '#94a3b8';
        }
    }

    public dispose(): void {
        if (this.storeUnsubscribe) this.storeUnsubscribe();
        if (this.saveUnsubscribe) this.saveUnsubscribe();
        if (this.element) {
            this.element.remove();
            this.element = null;
        }
    }

    private subscribe(): void {
        this.storeUnsubscribe = this.store.subscribe((state) => this.renderState(state));
        this.saveUnsubscribe = this.persistence.onStatusChange((status) => this.renderSaveStatus(status));
    }

    private renderState(state: EditorState): void {
        if (this.undoBtn) this.undoBtn.disabled = !state.canUndo;
        if (this.redoBtn) this.redoBtn.disabled = !state.canRedo;

        if (state.selectedFeatureId && this.featurePanel) {
            const doc = this.getDocument();
            const feature = doc?.getFeatureById(state.selectedFeatureId);
            if (feature) {
                this.featurePanel.style.display = 'flex';
                if (this.nameInput) this.nameInput.value = feature.name || '';
                if (this.descInput) this.descInput.value = feature.description || '';
            } else {
                this.featurePanel.style.display = 'none';
            }
        } else if (this.featurePanel) {
            this.featurePanel.style.display = 'none';
        }
    }

    private renderSaveStatus(status: SaveStatus): void {
        if (!this.saveBadge) return;
        switch (status) {
            case 'saving':
                this.saveBadge.textContent = 'Saving...';
                this.saveBadge.style.color = '#f1c40f';
                break;
            case 'saved':
                this.saveBadge.textContent = 'Saved';
                this.saveBadge.style.color = '#2ecc71';
                break;
            case 'error':
                this.saveBadge.textContent = 'Save Error';
                this.saveBadge.style.color = '#e74c3c';
                break;
            default:
                this.saveBadge.textContent = 'Loaded';
                this.saveBadge.style.color = '#94a3b8';
        }
    }

    private applyFeatureEdits(): void {
        const state = this.store.getState();
        if (!state.selectedFeatureId) return;

        const doc = this.getDocument();
        const feature = doc?.getFeatureById(state.selectedFeatureId);
        if (!feature) return;

        const newName = this.nameInput?.value.trim() ?? '';
        const newDesc = this.descInput?.value.trim() ?? '';

        if (newName !== feature.name) {
            this.store.executeCommand(createSetNameCommand(feature.id, newName));
        }
        if (newDesc !== feature.description) {
            this.store.executeCommand(createSetDescriptionCommand(feature.id, newDesc));
        }
    }

    private deleteSelectedFeature(): void {
        const state = this.store.getState();
        if (!state.selectedFeatureId) return;
        const featureId = state.selectedFeatureId;
        this.store.selectFeature(null);
        this.store.executeCommand(createDeleteFeatureCommand(featureId));
    }
}
