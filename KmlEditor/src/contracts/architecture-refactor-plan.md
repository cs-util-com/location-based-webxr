# Architecture Refactor Plan — Serializable Store & Shared Contracts

## Overview and Key Constraints

Everything in this application flows through a few core shared contracts. Getting them right before splitting up implementation work allows building independent components that combine cleanly.

### Critical Architecture Rules:

1. **No Invented Wrapper Components**: We adhere strictly to the original component structure (`kmz-io`, `document-model`, `geo-bridge`, `store`, `commands`, `persistence`, `renderers`, `editor`, `ar-scene`). We do NOT invent extra components such as `DocumentSession` or `WorkspaceController`.
2. **Single Source of Truth (SSOT) in Document Model**: The **Lossless KML Document Model (`IKmlDocument`)** is the sole owner and SSOT for all KML feature data (coordinates, names, descriptions, tree structure, and raw XML). Neither the store nor persistence holds a duplicate data store.
3. **Store Manages Transient App & UI State**: The `store` holds **only** transient application & UI state (`selectedFeatureId`, `editMode`, `documentStatus`, `documentRevision`, `device` GPS state, `canUndo`, `canRedo`). It does **NOT** duplicate feature attributes to prevent state drift and inconsistencies.
4. **Unidirectional Data Flow & Command Consistency**: Feature edits flow strictly in one direction:
   `User Input -> Edit Command -> Geo Bridge (3) -> In-Place IKmlDocument Mutation (2) -> Event / Revision Update -> Renderers & UI Update`.
5. **Atomic Mutations & Inverse Undo/Redo**: Commands perform atomic mutations directly on `IKmlDocument`. Undo/redo executes the corresponding inverse mutation on `IKmlDocument`, keeping document state and UI completely synchronized without maintaining parallel state trees.

---

## 1. Core Shared Contracts

### 1.1 KMZ Container Layer (`src/contracts/kmz-container.ts`)

Splits container I/O into container handling and asset resolution:
- **`IKmzContainer`**: Opens `.kmz` (ZIP containing `doc.kml` and referenced assets) or bare `.kml` (no ZIP wrapper). Extracts `doc.kml`, lists assets, updates `doc.kml`, and saves modified archive back.
- **`IAssetProvider`**: Small asset provider allowing renderers to request image or model resources by relative KML `href` (`getAssetUrl(href) -> Promise<string>`) and release them (`release(href)` / `dispose()`), without needing to know whether they come from a ZIP archive or remote URLs.

```ts
export interface IKmzContainer {
    open(source: File | ArrayBuffer | string): Promise<void>;
    getDocKml(): string;
    setDocKml(content: string): void;
    listAssets(): AssetEntry[];
    save(): Promise<ArrayBuffer>;
    getAssetProvider(): IAssetProvider;
    readonly isBareKml: boolean;
    dispose(): void;
}

export interface IAssetProvider {
    getAssetUrl(href: string): Promise<string>;
    release(href: string): void;
    getAssetBytes(href: string): Promise<Uint8Array>;
    hasAsset(href: string): boolean;
    dispose(): void;
}

export interface AssetEntry {
    path: string;
    size: number;
    modified: boolean;
}
```

---

### 1.2 Lossless KML Document Model (`src/contracts/document-model.ts`)

Parses `doc.kml` XML into a format-preserving DOM/CST tree:
- Preserves unknown elements, styles, folders, ExtendedData, attribute values, comments, and ordering.
- Exposes typed feature views (`IFeatureView[]` for markers, lines, ground overlays, 3D models) identified by `FeatureId`.
- **In-place mutations**: Edits mutate underlying XML nodes directly. Re-serializing (`serialize()`) alters only the nodes that were edited, preserving the rest byte-faithfully.

```ts
import { FeatureId, FeatureSnapshot, FeatureTemplate, GeoPosition, LatLonBox, AltitudeMode, ModelOrientation, ModelScale } from './type';

export interface IKmlDocument {
    parse(kmlString: string): void;
    serialize(): string;
    getFeatures(): IFeatureView[];
    getFeatureById(id: FeatureId): IFeatureView | null;
    insertFeature(template: FeatureTemplate, afterId?: FeatureId): FeatureId;
    removeFeature(id: FeatureId): FeatureSnapshot;
    restoreFeature(snapshot: FeatureSnapshot, afterId?: FeatureId): void;
    updateFeature(id: FeatureId, patch: Partial<IFeatureView>): void;
}

export interface IFeatureView {
    readonly id: FeatureId;
    readonly type: FeatureType;
    name: string;
    description: string;
    readonly kmlId?: string;
}

export type FeatureType = 'marker' | 'line' | 'ground-overlay' | 'model';

export interface IMarkerFeature extends IFeatureView {
    readonly type: 'marker';
    position: GeoPosition;
    iconHref: string | null;
    iconScale: number;
}

export interface ILineFeature extends IFeatureView {
    readonly type: 'line';
    coordinates: GeoPosition[];
}

export interface IGroundOverlayFeature extends IFeatureView {
    readonly type: 'ground-overlay';
    imageHref: string;
    latLonBox: LatLonBox;
    altitude: number;
    altitudeMode: AltitudeMode;
}

export interface IModelFeature extends IFeatureView {
    readonly type: 'model';
    location: GeoPosition;
    orientation: ModelOrientation;
    scale: ModelScale;
    modelHref: string;
    altitudeMode: AltitudeMode;
}
```

---

### 1.3 Geo ↔ World Bridge (`src/contracts/geo-bridge.ts`)

Pure conversion layer between geographic coordinates and WebXR / Three.js world-space meters:
- Converts geographic coordinates (lon, lat, alt + altitudeMode) to world vectors (`THREE.Vector3` / `WorldPosition`) and vice-versa.
- **Anchoring**: True geo-anchoring sitting at real-world coordinates.
  - In AR mode: origin is the live WebXR GPS pose from the framework.
  - In Desktop mode: bridge accepts an explicit reference anchor (data centroid or configured origin) strictly for local rendering convenience, without altering persisted coordinates.
- All downstream rendering, selection, and manipulation gizmos work strictly in world space.

```ts
import { GeoPosition, AltitudeMode, WorldPosition } from './type';

export interface IGeoBridge {
    setAnchor(anchor: GeoAnchor): void;
    getAnchor(): GeoAnchor | null;
    geoToWorld(position: GeoPosition, altitudeMode?: AltitudeMode): WorldPosition;
    worldToGeo(position: WorldPosition, altitudeMode?: AltitudeMode): GeoPosition;
    formatCoordinate(value: number, originalString?: string): string;
}

export interface GeoAnchor {
    position: GeoPosition;
    heading: number;
}
```

---

### 1.4 Store & Edit Commands (`src/contracts/store.ts` & `src/contracts/commands.ts`)

Runtime coordinator for application & UI state:
- Shared state across 2D DOM UI, 3D WebXR/Desktop Scene, and live GPS/Device state.
- **Strictly transient & serializable state**: Holds selection, edit modes, document load status, document revision counter, device/GPS state, and undo/redo flags.
- **No Duplicate Feature State**: Feature attributes (coordinates, names, descriptions) are queried directly from `IKmlDocument` via typed feature views, eliminating state drift between store and document model.

```ts
import { FeatureId } from './type';

export type EditMode = 'select' | 'move' | 'line-vertex' | 'overlay-transform' | 'model-transform';

export interface DeviceState {
    gpsPosition: { latitude: number; longitude: number; altitude: number } | null;
    heading: number | null;
    accuracy: number | null;
    isArActive: boolean;
}

export interface EditorState {
    readonly selectedFeatureId: FeatureId | null;
    readonly editMode: EditMode;
    readonly documentStatus: 'empty' | 'loading' | 'ready' | 'error';
    readonly documentRevision: number; // Incremented on every IKmlDocument mutation to trigger reactive UI updates
    readonly device: DeviceState;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
}

export type CommandType =
    | 'move-feature'
    | 'move-line-vertex'
    | 'add-line-vertex'
    | 'remove-line-vertex'
    | 'set-overlay-box'
    | 'set-model-transform'
    | 'set-name'
    | 'set-description'
    | 'create-feature'
    | 'delete-feature';

export interface IEditorStore {
    getState(): EditorState;
    selectFeature(id: FeatureId | null): void;
    setEditMode(mode: EditMode): void;
    setDeviceState(state: Partial<DeviceState>): void;
    notifyDocumentChanged(): void; // Increments revision counter
    undo(): void;
    redo(): void;
    subscribe(listener: (state: EditorState) => void): () => void;
}
```

---

## 2. Integration & Component Responsibilities

| Component | Responsibility | Does NOT Own |
| --- | --- | --- |
| **`kmz-io`** | ZIP archive opening, asset BlobUrl resolution, archive save | KML parsing, feature views, UI state |
| **`document-model`** | **Single Source of Truth (SSOT)**: Lossless XML tree parsing, in-place node mutation, typed feature views | ZIP I/O, App/UI state, Three.js objects |
| **`geo-bridge`** | Pure Geo <-> World position conversions given anchor | XML parsing, DOM UI, state storage |
| **`store`** | Transient UI state (`selectedFeatureId`, `editMode`, `documentRevision`, `deviceState`) | KML feature attributes, raw XML, `IKmlDocument`, `IKmzContainer`, Three.js objects |
| **`commands`** | Action-driven edit commands executing in-place mutations on `IKmlDocument` via Geo Bridge | Direct DOM rendering, persistence handles |
| **`persistence`** | Auto-save debouncing, File System Access API writing, export downloads | Document parsing, UI state management |
| **`renderers`** | Three.js 3D rendering for features & gizmos using Asset Provider & Geo Bridge | Feature state mutation, persistence |
| **`editor` / `ar-scene`** | 2D UI & 3D Desktop / WebXR view rendering, subscribing to Store & Document Model changes | Direct XML mutation |

---

### 2.1 Inconsistency Prevention Architecture

To guarantee zero state drift between `document-model` and `store`, the application strictly enforces:

1. **Single Source of Truth (SSOT)**: `IKmlDocument` is the sole owner of all feature data (coordinates, names, descriptions, tree structure). The `store` holds only selection, edit modes, device GPS state, and a reactive `documentRevision` counter.
2. **Unidirectional Data Flow**:
   ```
   User Interaction (Desktop Drag / AR Grab)
       │
       ▼
   Edit Command (e.g. MoveMarkerCommand)
       │
       ▼
   Geo Bridge (World-Space ──> Geo Coordinates)
       │
       ▼
   IKmlDocument In-Place Mutation (XML node updated)
       │
       ▼
   Store.notifyDocumentChanged() (Revision counter incremented)
       │
       ▼
   Subscribers (Renderers & 2D UI) Re-render from IKmlDocument
   ```
3. **Atomic Transations & Inverse Mutations for Undo/Redo**: Every edit command applies an atomic mutation to `IKmlDocument`. Undo/redo executes the corresponding inverse mutation directly against `IKmlDocument`, guaranteeing that document state, UI selection, and 3D scenes stay 100% in sync without duplicated state trees.
