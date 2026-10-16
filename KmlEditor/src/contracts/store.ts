import { FeatureId } from './type';
import { ICommand } from './commands';

export type EditMode = 'select' | 'move' | 'line-vertex' | 'overlay-transform' | 'model-transform';

export interface DeviceState {
    gpsPosition: { latitude: number; longitude: number; altitude: number } | null;
    heading: number | null;
    accuracy: number | null;
    isArActive: boolean;
}

/** Pure, serializable Redux store state for transient UI & app state */
export interface EditorState {
    readonly selectedFeatureId: FeatureId | null;
    readonly editMode: EditMode;
    readonly documentStatus: 'empty' | 'loading' | 'ready' | 'error';
    readonly documentRevision: number;
    readonly device: DeviceState;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
}

export interface IEditorStore {
    /** Retrieve current serializable state */
    getState(): EditorState;

    /** Feature selection */
    selectFeature(id: FeatureId | null): void;

    /** UI Edit Mode setter */
    setEditMode(mode: EditMode): void;

    /** Device / GPS state update */
    setDeviceState(state: Partial<DeviceState>): void;

    /** Execute edit command action */
    executeCommand(command: ICommand): void;

    /** Notify subscribers that document mutated */
    notifyDocumentChanged(): void;

    /** Undo last edit action */
    undo(): void;

    /** Redo last undone action */
    redo(): void;

    /** Listener for state changes */
    subscribe(listener: (state: EditorState) => void): () => void;
}

