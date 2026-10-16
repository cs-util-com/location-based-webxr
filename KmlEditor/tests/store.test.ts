import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEditorStore } from '../src/store';
import { editorReducer, initialEditorState, setSelectedFeatureId, setEditMode } from '../src/store/redux-store';
import { ICommand } from '../src/contracts/commands';
import { FeatureId } from '../src/contracts/type';
import { IKmlDocument } from '../src/contracts/document-model';
import { IGeoBridge } from '../src/contracts/geo-bridge';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/google-earth');

describe('KML Editor Store Component', () => {
    let dreieckFile: File;
    let corruptFile: File;

    beforeEach(() => {
        const kmlData = fs.readFileSync(path.join(fixturesDir, 'dreieck.kml'));
        dreieckFile = new File([kmlData], 'dreieck.kml', { type: 'application/vnd.google-earth.kml+xml' });
        corruptFile = new File([new TextEncoder().encode('invalid kml text')], 'corrupt.kml', { type: 'application/vnd.google-earth.kml+xml' });
    });

    it('should have initial state and inactive commands', () => {
        const store = createEditorStore();
        const state = store.getState();
        expect(state.documentStatus).toBe('empty');
        expect(state.selectedFeatureId).toBeNull();
        expect(state.canUndo).toBe(false);
        expect(state.canRedo).toBe(false);
    });

    it('should load file, parse features into serializable state, set anchor and notify subscribers', async () => {
        const store = createEditorStore();
        let notifiedState: any = null;

        const unsubscribe = store.subscribe((state) => {
            notifiedState = state;
        });

        await store.loadFile(dreieckFile);

        const state = store.getState();
        expect(state.documentStatus).toBe('ready');
        expect(state.documentRevision).toBeGreaterThan(0);
        expect((store as any).document.getFeatures().length).toBeGreaterThan(0);
        expect(notifiedState).not.toBeNull();
        expect(notifiedState.documentStatus).toBe('ready');

        expect(store.geoBridge.geoToWorld({ lon: 6.06078, lat: 50.7781, alt: 0 })).toBeDefined();

        unsubscribe();
    });

    it('should maintain transaction safety and set status on corrupt file loads', async () => {
        const store = createEditorStore();

        // First load a valid file
        await store.loadFile(dreieckFile);
        const validState = store.getState();
        expect(validState.documentStatus).toBe('ready');

        // Load a corrupt file, expect reject
        await expect(store.loadFile(corruptFile)).rejects.toThrow();

        expect(store.getState().documentStatus).toBe('error');
    });

    it('should abort previous loading promise on concurrent calls', async () => {
        const store = createEditorStore();

        const load1 = store.loadFile(dreieckFile);
        const load2 = store.loadFile(dreieckFile);

        await expect(load1).rejects.toThrow();
        await expect(load2).resolves.toBeUndefined();
    });

    it('should update selection ID and broadcast updates', async () => {
        const store = createEditorStore();
        await store.loadFile(dreieckFile);

        let activeSelection: any = null;
        store.subscribe((state) => {
            activeSelection = state.selectedFeatureId;
        });

        const targetId = 'test-id' as FeatureId;
        store.selectFeature(targetId);
        expect(store.selectedFeatureId).toBe(targetId);
        expect(activeSelection).toBe(targetId);

        store.selectFeature(null);
        expect(store.selectedFeatureId).toBeNull();
        expect(activeSelection).toBeNull();
    });

    it('should execute, undo, and redo commands updating store state and subscribers', async () => {
        const store = createEditorStore();
        await store.loadFile(dreieckFile);

        let changeNotificationsCount = 0;
        store.subscribe(() => {
            changeNotificationsCount++;
        });

        const mockCommand: ICommand = {
            type: 'set-name',
            featureId: '0DE3B1799F402F179797' as FeatureId,
            description: 'Rename test',
            execute: vi.fn((doc: IKmlDocument, bridge: IGeoBridge) => {
                const feat = doc.getFeatureById('0DE3B1799F402F179797' as FeatureId);
                if (feat) feat.name = 'New Name';
            }),
            undo: vi.fn((doc: IKmlDocument, bridge: IGeoBridge) => {
                const feat = doc.getFeatureById('0DE3B1799F402F179797' as FeatureId);
                if (feat) feat.name = 'busch_infozentrum';
            })
        };

        const initialNotifications = changeNotificationsCount;

        store.executeCommand(mockCommand);
        expect(mockCommand.execute).toHaveBeenCalled();
        expect(store.getState().canUndo).toBe(true);
        expect(changeNotificationsCount).toBeGreaterThan(initialNotifications);

        const currentName = (store as any).document?.getFeatureById('0DE3B1799F402F179797' as FeatureId)?.name;
        expect(currentName).toBe('New Name');

        // Undo
        store.undo();
        expect(mockCommand.undo).toHaveBeenCalled();
        expect(store.getState().canUndo).toBe(false);
        expect(store.getState().canRedo).toBe(true);
        expect((store as any).document?.getFeatureById('0DE3B1799F402F179797' as FeatureId)?.name).toBe('busch_infozentrum');

        // Redo
        store.redo();
        expect(store.getState().canUndo).toBe(true);
        expect((store as any).document?.getFeatureById('0DE3B1799F402F179797' as FeatureId)?.name).toBe('New Name');
    });

    it('should trigger dispose on container when reload occurs', async () => {
        const store = createEditorStore();

        await store.loadFile(dreieckFile);
        const container1 = store.container;
        const disposeSpy = vi.spyOn(container1!, 'dispose');

        // Reload
        await store.loadFile(dreieckFile);
        expect(disposeSpy).toHaveBeenCalled();
    });
});

describe('Editor Redux Reducer', () => {
    it('should return initial state by default', () => {
        expect(editorReducer(undefined, { type: '@@INIT' } as any)).toEqual(initialEditorState);
    });

    it('should handle setSelectedFeatureId action', () => {
        const state = editorReducer(initialEditorState, setSelectedFeatureId('marker-1' as FeatureId));
        expect(state.selectedFeatureId).toBe('marker-1');
    });

    it('should handle setEditMode action', () => {
        const state = editorReducer(initialEditorState, setEditMode('move'));
        expect(state.editMode).toBe('move');
    });
});
