import { createSlice, configureStore, PayloadAction } from '@reduxjs/toolkit';
import { FeatureId } from '../contracts/type';
import { EditMode, DeviceState, EditorState } from '../contracts/store';

export const initialDeviceState: DeviceState = {
    gpsPosition: null,
    heading: null,
    accuracy: null,
    isArActive: false,
};

export const initialEditorState: EditorState = {
    selectedFeatureId: null,
    editMode: 'select',
    documentStatus: 'empty',
    documentRevision: 0,
    device: initialDeviceState,
    canUndo: false,
    canRedo: false,
};

const editorSlice = createSlice({
    name: 'editor',
    initialState: initialEditorState,
    reducers: {
        incrementDocumentRevision(state) {
            state.documentRevision += 1;
            state.documentStatus = 'ready';
        },
        setSelectedFeatureId(state, action: PayloadAction<FeatureId | null>) {
            state.selectedFeatureId = action.payload;
        },
        setEditMode(state, action: PayloadAction<EditMode>) {
            state.editMode = action.payload;
        },
        setDocumentStatus(state, action: PayloadAction<EditorState['documentStatus']>) {
            state.documentStatus = action.payload;
        },
        setDeviceState(state, action: PayloadAction<Partial<DeviceState>>) {
            state.device = { ...state.device, ...action.payload };
        },
        setUndoRedoState(state, action: PayloadAction<{ canUndo: boolean; canRedo: boolean }>) {
            state.canUndo = action.payload.canUndo;
            state.canRedo = action.payload.canRedo;
        },
        resetStore(state) {
            state.selectedFeatureId = null;
            state.editMode = 'select';
            state.documentStatus = 'empty';
            state.documentRevision = 0;
            state.device = initialDeviceState;
            state.canUndo = false;
            state.canRedo = false;
        },
    },
});

export const {
    incrementDocumentRevision,
    setSelectedFeatureId,
    setEditMode,
    setDocumentStatus,
    setDeviceState,
    setUndoRedoState,
    resetStore,
} = editorSlice.actions;

export const editorReducer = editorSlice.reducer;

/**
 * Configures the Redux Toolkit store.
 * Standard serializability check is ENABLED since all fields are pure serializable objects.
 */
export function createReduxStore() {
    return configureStore({
        reducer: editorReducer,
        middleware: (getDefaultMiddleware) => getDefaultMiddleware({
            serializableCheck: true,
        }),
    });
}

