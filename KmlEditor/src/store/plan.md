# KML Editor Store Component (Redux-Based) Implementation Plan

## Overview

The `store` component acts as the global state orchestrator for the KML Editor. It is refactored to implement a **Redux Architecture** internally. State is stored in a single immutable state tree, mutated via pure reducer functions in response to dispatched actions, and made available to subscribers. 

To keep the codebase modular and compatible with other components, the store exposes a **Facade Class** (`EditorStoreImpl`) that implements the required `IEditorStore` contract exactly. This bridges the clean, interface-driven api with Redux's state management patterns.

### Boundaries & Constraints
*   **What it owns:**
    *   The internal Redux Store instance, state definitions, action creators, and reducer.
    *   The active `EditorReduxState` containing references to `IKmlDocument`, `IKmzContainer`, `selectedFeatureId`, and state `version`.
    *   The active coordinate bridge (`IGeoBridge`).
*   **What it never owns:**
    *   File reading/writing (owned by `persistence`).
    *   In-place XML structural modifications (owned by `kml-model`).
    *   3D meshes or visual canvas render loops (owned by `renderers` and `ar-scene`).
*   **Contracts Consumed:**
    *   `IKmlDocument` (`contracts/document-model.ts`)
    *   `IKmzContainer` (`contracts/kmz-container.ts`)
    *   `IGeoBridge` (`contracts/geo-bridge.ts`)
    *   `ICommandStack`, `ICommand` (`contracts/commands.ts`)
*   **Contracts Implemented:**
    *   `IEditorStore` (`contracts/store.ts`)

---

## Internal Architecture

The store utilizes a lightweight, zero-dependency TypeScript Redux implementation to maintain maximum performance and avoid monorepo installation issues.

```
+--------------------------------------------------------------------------+
|                            IEditorStore Facade                           |
|                             (EditorStoreImpl)                            |
+---------+--------------------------+---------------------------+---------+
          | (getters / methods)      | (subscribe)               | (dispatch)
          v                          v                           v
   [ Redux State ] <--------- [ Redux Subscribers ] <------- [ Redux Store ]
          |                                                      ^
          | (reads state)                                        | (reduces action)
          +------------------------------------------------------+
```

### 1. EditorReduxState (The State)
Stores the entire reactive state of the workspace:
*   `document: IKmlDocument | null`
*   `container: IKmzContainer | null`
*   `selectedFeatureId: FeatureId | null`
*   `version: number` (A counter incremented on every document mutation, forcing subscribers to redraw)

### 2. Actions & Action Creators
*   `LOAD_FILE_SUCCESS` (payload: `{ document, container }`)
*   `SELECT_FEATURE` (payload: `{ id }`)
*   `MUTATE_DOCUMENT` (payload: void, signals a command execution/undo/redo mutation occurred)
*   `RESET_STORE` (payload: void)

### 3. Redux Store & Reducer (`editorReducer`)
A pure function that calculates the next state based on the current state and action:
```typescript
function editorReducer(state: EditorReduxState, action: Action): EditorReduxState;
```

### 4. EditorStoreImpl (The Facade Wrapper)
Implements `IEditorStore`. Holds the Redux store instance, implements getter properties that read directly from `reduxStore.getState()`, and dispatches actions internally.

---

## Runtime Data Flow

### 1. File Loading Flow (Redux Thunk-like Pipeline)
1.  UI calls `store.loadFile(file)`.
2.  Store aborts previous loading tasks.
3.  Store opens container, parses document.
4.  Upon successful loading, store dispatches action:
    ```typescript
    dispatch({
        type: 'LOAD_FILE_SUCCESS',
        payload: { document: tempDoc, container: tempContainer }
    });
    ```
5.  Reducer returns the new state with the document, container, and resets selection.
6.  The store triggers its subscribers, updates the active command stack, and re-establishes coordinate anchors.

### 2. Selection Flow
1.  User clicks a feature $\rightarrow$ calls `store.selectFeature(featureId)`.
2.  Store dispatches `SELECT_FEATURE` action:
    ```typescript
    dispatch({ type: 'SELECT_FEATURE', payload: { id: featureId } });
    ```
3.  Reducer returns updated state: `{ ...state, selectedFeatureId: action.payload.id }`.
4.  Redux notifies subscribers $\rightarrow$ visual handles are updated.

### 3. Command Execution Flow (In-place Mutation Bridge)
1.  UI calls `store.executeCommand(command)`.
2.  The store forwards the call to the active command stack: `this.commands.execute(command)`.
3.  The command stack performs the in-place XML mutation.
4.  The command stack fires its change listener.
5.  The store intercepts this change and dispatches:
    ```typescript
    dispatch({ type: 'MUTATE_DOCUMENT' });
    ```
6.  Reducer returns state with incremented version: `{ ...state, version: state.version + 1 }`.
7.  All outer subscribers are notified of the document mutation.

---

## Public Surface

```typescript
import { IEditorStore, EditorState } from '../contracts/store';
import { IKmlDocument } from '../contracts/document-model';
import { IKmzContainer } from '../contracts/kmz-container';
import { ICommandStack, ICommand } from '../contracts/commands';
import { IGeoBridge } from '../contracts/geo-bridge';
import { FeatureId } from '../contracts/type';

export interface EditorReduxState {
    document: IKmlDocument | null;
    container: IKmzContainer | null;
    selectedFeatureId: FeatureId | null;
    version: number;
}

export type Action =
    | { type: 'LOAD_FILE_SUCCESS'; payload: { document: IKmlDocument; container: IKmzContainer } }
    | { type: 'SELECT_FEATURE'; payload: { id: FeatureId | null } }
    | { type: 'MUTATE_DOCUMENT' }
    | { type: 'RESET_STORE' };

export class EditorStoreImpl implements IEditorStore {
    public readonly geoBridge: IGeoBridge;
    
    private readonly _reduxStore: ReduxStore;
    private readonly _commandsDelegator: CommandStackDelegator;
    private _activeStack: ICommandStack | null = null;
    private _activeLoadController: AbortController | null = null;
    private _stackChangeListenerUnsubscribe: (() => void) | null = null;

    constructor();

    public get document(): IKmlDocument | null;
    public get container(): IKmzContainer | null;
    public get commands(): ICommandStack;
    public get selectedFeatureId(): FeatureId | null;

    public loadFile(file: File): Promise<void>;
    public selectFeature(id: FeatureId | null): void;
    public executeCommand(command: ICommand): void;
    public subscribe(listener: (state: EditorState) => void): () => void;
}
```

---

## Algorithms

### 1. Pure State Reducer Algorithm
The state changes are governed by the following pure transition logic:
```typescript
export function editorReducer(state: EditorReduxState, action: Action): EditorReduxState {
    switch (action.type) {
        case 'LOAD_FILE_SUCCESS':
            return {
                ...state,
                document: action.payload.document,
                container: action.payload.container,
                selectedFeatureId: null,
                version: state.version + 1
            };
        case 'SELECT_FEATURE':
            return {
                ...state,
                selectedFeatureId: action.payload.id
            };
        case 'MUTATE_DOCUMENT':
            return {
                ...state,
                version: state.version + 1
            };
        case 'RESET_STORE':
            return {
                document: null,
                container: null,
                selectedFeatureId: null,
                version: state.version + 1
            };
        default:
            return state;
    }
}
```

### 2. Transactional load-then-swap thunk
To maintain state safety, raw file reading and parsing is performed as a thunk-like wrapper. The Redux store is only mutated via `LOAD_FILE_SUCCESS` *after* the file is fully read and validated, keeping the state safe from loading errors.

---

## State Management

*   **Redux Store:** Implements the state container.
*   **Immutability:** Redux state objects are replaced immutably.
*   **In-Place KML References:** KML document instances are kept as stable references inside the state. A mutated state is triggered by incrementing the `version` field.

---

## Testing Strategy

All store tests verify Redux state flows:
*   **Reducer Tests:** Unit-test the `editorReducer` with mock actions to ensure state transitions are correct.
*   **Dispatch Tests:** Verify that calling `selectFeature()` or `loadFile()` dispatches the correct actions and updates the store state.
*   **History Undo/Redo Integration:** Verify that executing commands fires mutations that increment the Redux state version correctly.
