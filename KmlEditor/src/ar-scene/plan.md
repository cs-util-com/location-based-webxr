# AR Viewing / Editing Scene — Implementation Plan (Revised)

> **Hinweis:** Der erste Implementierungsversuch dieser Komponente hat fälschlicherweise Kernfunktionalität (WebXR-Session-Lifecycle, Renderer-Erzeugung, Sensor-Watches, Szene-Hierarchie) selbst implementiert, die das Framework `gps-plus-slam-app-framework` bereits vollständig bereitstellt. Dieser Plan beschreibt die korrigierte Architektur, in der `ar-scene` ausschließlich die anwendungsspezifische KML-Logik beisteuert und das gesamte AR-Lifecycle-Management an das Framework delegiert.

---

## Overview

`src/ar-scene` ist die finale Kompositionswurzel (Komponente 8) der `KmlEditor`-Anwendung. Sie verbindet die KML-Engine, den Geo-Koordinaten-Bridge, die Feature-Renderer, Edit-Commands, den Store und den Persistence-Service zu einem mobilen WebXR-Erlebnis — **ausgebaut auf dem Framework `gps-plus-slam-app-framework`**, nicht neben ihm.

### Boundaries

**Es besitzt:**
- Die anwendungsspezifische Wiring-Logik: Verbindung von Framework-GPS-Events → `ArAnchorCoordinator` → `IGeoBridge` und weiter zu `FeatureSceneRegistry`.
- Das Einhängen der KML-Feature-Objekte in die GPS-Welt-Szene von `getScene()`.
- Das AR HUD (DOM-Overlay für Tracking-Status, GPS-Genauigkeit, Undo/Redo, Property-Editing).
- Die Touch-Gesten-Logik: Screen-Raycast → `ICommand` → `IEditorStore`.
- Den `ArAnchorCoordinator` (Anchor-Lock, GPS-Filterung, Heading-Initialisierung, Altitude-Policy-Entscheidung).
- Den Replay-Adapter für phone-freie Desktop-Tests.
- Die `PersistenceCoordinator`-Wiring (Store-Subscription → `IPersistenceService`).
- Die Editing-UX-Entscheidung: welche Geste bedeutet was auf Phone vs. Desktop.
- Graceful Degradation bei großen Dateien: ArHud-Warning statt Freeze, selektives Culling ohne Datenverlust.

**Es besitzt NICHT:**
- WebXR-Session-Erzeugung (`navigator.xr.requestSession`), XRReferenceSpace, Renderer-Erstellung, AnimationLoop — alles übernimmt `initAR()` aus dem Framework.
- GPS-/Orientation-Watch-Lifecycle: übernimmt `createEnableGpsArController()` aus dem Framework.
- Die Szenen-Hierarchie (`THREE.Scene`, `arWorldGroup`, `basisChangeNode`, `arPoseNode`, `camera`) — erzeugt `initAR()`, abgerufen über `getScene()`, `getArWorldGroup()`, `getCamera()`.
- Sensor-Permissions: übernimmt der `EnableGpsArController` des Frameworks.
- ZIP-Unpacking, KML-Parsing, Geo-Mathematik, Renderer-Geometrien — andere Komponenten.

### Framework-Funktionen, die direkt genutzt werden

| Framework-Export | Subpfad | Zweck |
|---|---|---|
| `initAR(container, isolationOptions, sessionFeatures)` | `gps-plus-slam-app-framework/ar` | Startet WebXR, erstellt Renderer, Szene, AnimationLoop |
| `endARSession()` | `gps-plus-slam-app-framework/ar` | Beendet Session, gibt GPU-Ressourcen frei |
| `getScene()` | `gps-plus-slam-app-framework/ar` | Liefert die aktive `THREE.Scene` |
| `getScene()` | `gps-plus-slam-app-framework/ar` | Liefert die GPS-Welt-Szene — hier hängen KML-Objekte mit GeoBridge-Koordinaten |
| `getArWorldGroup()` | `gps-plus-slam-app-framework/ar` | Liefert die AR-lokale Gruppe für Kamera und AR-Inhalte |
| `getCamera()` | `gps-plus-slam-app-framework/ar` | Liefert die aktive `THREE.PerspectiveCamera` |
| `registerFrameUpdate(fn)` | `gps-plus-slam-app-framework/ar` | Registriert einen per-frame Tick ohne eigenen AnimationLoop |
| `setTrackingLostCallback(cb)` | `gps-plus-slam-app-framework/ar` | Callback wenn Tracking verloren |
| `createEnableGpsArController(deps?)` | `gps-plus-slam-app-framework/ar` | Orchestriert Permissions + Sensor-Watches + `initAR` in einem In-Gesture-Flow |
| `startGpsWatch / stopGpsWatch` | `gps-plus-slam-app-framework/sensors` | GPS-Position-Watch (direkt genutzt falls kein EnableGpsArController gewünscht) |
| `startOrientationWatch / stopOrientationWatch` | `gps-plus-slam-app-framework/sensors` | Kompass-/IMU-Watch |

### Contracts Consumed
- `IEditorStore` und `EditorState` aus `contracts/store.ts`
- `IKmlDocument`, `IFeatureView` aus `contracts/document-model.ts`
- `IKmzContainer`, `IAssetProvider` aus `contracts/kmz-container.ts`
- `IFeatureRenderer`, `IRendererFactory` aus `contracts/renderer.ts`
- `ICommand` aus `contracts/commands.ts`
- `IPersistenceService` aus `contracts/persistence.ts`
- `IGeoBridge`, `GeoAnchor` aus `contracts/geo-bridge.ts`
- `FeatureId`, `WorldPosition`, `GeoPosition`, `AltitudeMode` aus `contracts/type.ts`

### Contracts Implemented
Keine. `ar-scene` ist die Top-Level-Kompositionswurzel. Sie konsumiert bestehende Contracts ohne neue einzuführen.

---

## Core Product Commitments (ar-scene scope)

Diese Anforderungen gelten für die gesamte App, aber die konkrete Umsetzung liegt in `ar-scene`.

### World-Space-First — keine Geo-Mathematik in ar-scene

`ar-scene` schreibt **niemals** Haversine-, Equirectangular- oder andere Geo-Koordinaten-Formeln. Die einzige geo→world Konvertierung erfolgt in `IGeoBridge` (Komponente 4). Danach arbeitet `ar-scene` ausschließlich mit `THREE.Vector3` in Metern:

```typescript
// Richtig: world-space Distanz
const dist = featureObject.position.distanceTo(cameraWorldPos);

// Falsch: würde Haversine brauchen — niemals in ar-scene
const dist = haversine(feature.geo, userGeo);
```

Gilt für: Rendering, Culling, Drag-Mathematik, Raycast, Anchor-Lock-Proximity-Checks. Alle Konvertierungen gehen durch `geoBridge.geoToWorld()` / `geoBridge.worldToGeo()`.

### Editing UX Contract: Phone vs. Desktop

Die Edit-Mathematik (Drag-Plane-Intersection, `MoveMarkerCommand`, `MoveLineVertexCommand`) ist identisch auf beiden Plattformen. Was sich unterscheidet ist die Geste:

| Aktion | Phone (WebXR AR) | Desktop (Replay-Preview) |
|---|---|---|
| Feature auswählen | Single-tap → Raycast | Mouse-click → Raycast |
| Marker / Modell verschieben | Tap + drag (grab-to-move auf Drag-Plane) | Mouse-drag auf Drag-Plane |
| Linienpunkt verschieben | Tap Vertex-Handle + drag | Mouse-drag Vertex-Handle |
| Metadaten editieren (Name, Beschreibung) | 2D-Panel im ArHud (DOM-Formular, kein 3D-Gizmo) | Identisches Panel in der Desktop-Preview |
| Rotation / Skalierung von Modellen | **Nicht in Iteration 1** — zu fiddly für Handheld-AR; als Follow-up geplant | Identisch zurückgestellt |

Rotation und Skalierung von Modellen sind für Iteration 1 bewusst ausgelassen. Die KML-Bytes für `<Orientation>` und `<Scale>` bleiben dabei vollständig erhalten (Lossless-Garantie liegt in `document-model`, `ar-scene` bricht sie nicht).

### AltitudeMode Policy (dokumentierte Entscheidung)

In einer AR-Session ist „Boden" nur bekannt als WebXR `local-floor`-Referenzraum (Y = 0). Es gibt keinen DEM (Digital Elevation Model) im Browser.

| KML-altitudeMode | AR-Verhalten | Begründung |
|---|---|---|
| `clampToGround` (Google-Earth-Standard) | Feature-Y = 0 (auf dem AR-Boden-Plane). | Einzige sinnvolle Annäherung ohne Gelände-Mesh. |
| `relativeToGround` | Feature-Y = kml.alt (Meter über dem AR-Boden-Plane). | Erhöht das Feature um den gespeicherten Wert. |
| `absolute` | Feature-Y = kml.alt − anchor.alt via `geoBridge.geoToWorld()`. | Direkte Meter-Offset über den Meeresspiegel des Anchor-Punktes. |

ArHud zeigt eine nicht-intrusive Warnung wenn `clampToGround`-Features weiter als 30 m vom Anchor entfernt sind (Terrain-Neigung kann dort nicht berücksichtigt werden).

### Große Dateien — kein Crash, kein Datenverlust

`ar-scene` ist nicht verantwortlich für das Parsing großer Dateien. Die Verantwortung von `ar-scene` ist:

1. **Kein Freeze:** `FeatureSceneRegistry.reconcile()` läuft `async` — der Framework-AnimationLoop blockiert nicht.
2. **Warning statt Crash:** Wenn `IKmlDocument.getFeatures().length > 500`, zeigt ArHud eine einmalige Warning: „Große Datei: nur Features innerhalb 500 m werden dargestellt."
3. **Selektives Rendering:** Features > 500 m vom Anchor: `visible = false`. Im Dokument und in den KMZ-Bytes vollständig erhalten.
4. **Datenverlust ist verboten:** Ein Feature, das nicht gerendert wird (zu weit, VRAM-Budget), darf in den KMZ-Bytes niemals verändert oder weggelassen werden. Diese Garantie liegt in `document-model` — `ar-scene` berührt sie nicht.

---


## Internal Architecture

```text
ArApp (Kompositionswurzel & Lifecycle)
 ├── EnableGpsArController         [Framework] orchestriert Permissions + Sensor + initAR
 ├── ArAnchorCoordinator           [App]        GPS-Events → IGeoBridge-Anchor-Updates
 ├── FeatureSceneRegistry          [Editor]     reconcile IKmlDocument.getFeatures() → THREE.Object3D
 │    └── hängt in getScene()         [Framework] GPS-Welt-Szene
 ├── ArInteractionController       [App]        Touch → Raycast → ICommand
 ├── ArHud                         [App]        DOM-Overlay (Status, Undo/Redo, Properties)
 ├── ArReplayAdapter               [App]        phone-freie Tests via RecordedDataset
 └── PersistenceCoordinator        [Editor]     Store-Subscription → IPersistenceService
```

### Module Breakdown

#### 1. `ar-app.ts` (`ArApp`)

**Responsibility:** Kompositionswurzel. Instantiiert alle Teilkomponenten, verbindet Framework-Events mit App-Logik, verwaltet den Applikationslebenszyklus.

**Was es explizit NICHT selbst tut:**
- Keinen `THREE.WebGLRenderer` erstellen → Framework.
- Keine `THREE.Scene` erstellen → Framework.
- Kein `navigator.xr.requestSession` aufrufen → Framework.
- Keinen `setAnimationLoop` aufrufen → Framework.

**Startsequenz `startArSession()`:**
1. Ruft `enableGpsArController.enable({ container, onGpsPosition, onOrientation })` auf.
   - Intern: Framework fragt Permissions ab, startet `initAR(container)`, startet GPS/Orientation-Watches und feuert `onGpsPosition`/`onOrientation`-Callbacks für die App.
2. Nach erfolgreichem `enable()`: holt `getScene()` und hängt `featureGroup` (von `FeatureSceneRegistry`) als Kind ein.
3. Registriert einen per-frame Tick via `registerFrameUpdate(fn)` für KML-Feature-Updates (z.B. Accuracy-Ring-Position, Anchor-Koordinaten-Refresh).

**Stoppsequenz `stopArSession()`:**
1. Ruft `enableGpsArController.disable()` auf → Framework stoppt GPS-Watch, Orientation-Watch und `endARSession()`.
2. Entfernt `featureGroup` aus `getScene()`.
3. Entregistriert per-frame Tick.

**Inputs:** Host-DOM-Container, optionaler `IEditorStore`, optionaler `IPersistenceService`.
**Outputs:** Gemounteter AR-Canvas, Session-Controls (`startArSession()`, `stopArSession()`, `dispose()`).
**Invarianten:** Exakt eine aktive AR-Session gleichzeitig. Teardown gibt WebXR-Ressourcen (Framework), Three.js-Objekte und Store-Subscriptions sauber frei.

---

#### 2. `ar-anchor-coordinator.ts` (`ArAnchorCoordinator`)

**Responsibility:** Empfängt GPS-Updates und Kompass-Heading-Updates aus den Framework-Sensor-Callbacks und setzt daraus den `IGeoBridge`-Anchor. Implementiert Anchor-Lock während aktiver 3D-Drags und Heading-Initialisierung beim ersten GPS-Fix.

**Inputs:** `IGeoBridge`, `IEditorStore`, GPS-Position (via `onGpsPosition`-Callback), Heading (via `onOrientation`-Callback).
**Outputs:** Aktualisierter `GeoAnchor` auf `IGeoBridge`, der `FeatureSceneRegistry.reconcile()` über Store-Change transitiv neu auslöst.
**Kein direkter XRFrame-Zugriff** — der AR-Viewer-Pose-Zugriff (für Anchor-Lock-Proximity-Checks) wird indirekt über die FeatureGroup-World-Position oder einen optionalen `registerFrameUpdate`-Tick gelöst, nicht über eigenen AnimationLoop.
**Invarianten:**
- Während `isAnchorLocked === true` (aktive Touch-Drags): GPS-Updates werden gebuffert, nicht auf `IGeoBridge` angewendet.
- `resetAnchor()` wird nur beim ersten GPS-Fix aufgerufen.
- Heading-Initialisierung erfolgt sobald der erste nicht-null Alpha-Wert aus dem Orientation-Callback ankommt.

---

#### 3. `ar-scene-manager.ts` (stark vereinfacht → `KmlSceneHelper`)

**Responsibility:** Der ursprüngliche `ArSceneManager` hat eine eigene `THREE.Scene` und `THREE.WebGLRenderer` erstellt — das ist jetzt die Aufgabe des Frameworks. Der verbleibende Verantwortungsbereich ist:
- Verwaltung der `FeatureSceneRegistry` (reconcile KML-Features → THREE.Object3D).
- Verwaltung der app-spezifischen Hilfs-Meshes: GPS-Accuracy-Ring, optionaler Reticle-Indicator.
- Desktop-Fallback-Preview: OrbitControls für phone-freie Entwicklung (nur aktiv wenn kein XR-Session läuft).

**Szenen-Zugriff ausschließlich via Framework-Getter:**
```typescript
import { getArWorldGroup, getCamera } from 'gps-plus-slam-app-framework/ar';

// Feature-Gruppe als Kind der Framework-World-Group einhängen:
const worldGroup = getArWorldGroup();
worldGroup?.add(this.featureGroup);
```

**Kein eigener Renderer, keine eigene Szene, kein eigener AnimationLoop.** Render-Tick wird via `registerFrameUpdate` registriert (für OrbitControls-Update im Desktop-Modus).

---

#### 4. `ar-interaction-controller.ts` (`ArInteractionController`)

**Responsibility:** Übersetzt 2D-Touch-Events auf dem AR-Screen in 3D-Raycasts gegen Feature-Meshes aus `getArWorldGroup()`, produziert `ICommand`-Instanzen (`MoveMarkerCommand` etc.) und dispatcht sie via `IEditorStore.executeCommand()`.

**Raycasting:** Nutzt `getCamera()` vom Framework als Raycasting-Quelle. Raycast-Target ist `featureGroup.children`.
**Drag-Plane:** Konstruiert eine virtuelle Plane am initialen Pick-Punkt, parallel zur Viewer-Camera (kein XRFrame benötigt für die Ebene selbst — nur Screen-NDC-Koordinaten und `getCamera()`-Projektionsmatrix).
**Invarianten:** Touch-Events auf HUD-Controls propagieren nicht in den Interaction-Controller (stopPropagation). Gesture completion (`touchend`) erzeugt atomare Undo-History-Einträge.

---

#### 5. `ar-hud.ts` (`ArHud`)

**Responsibility:** Rendert ein responsives 2D-DOM-Overlay über dem AR-Canvas. Status-Feedback aus:
- `EnableGpsArController.subscribe(state => ...)`: zeigt `checking` / `starting` / `running` / `error` an.
- `IEditorStore` State-Updates: Undo/Redo verfügbar, selektiertes Feature, Property-Modals.
- `IPersistenceService` Status: `idle` → `saving` → `saved`.
- `setTrackingLostCallback` aus dem Framework: zeigt „Tracking verloren"-Warnung.

**Kein DOM-Overlay-Root-Management** — das Framework übernimmt das dom-overlay-Feature als Teil von `initAR`; ArHud montiert seine DOM-Elemente lediglich in den vom Aufrufer übergebenen Container (der auch der dom-overlay-Root ist).

---

#### 6. `ar-replay-adapter.ts` (`ArReplayAdapter`)

**Responsibility:** Speist aufgezeichnete Task-1-Datensätze (GPS, IMU) in `ArAnchorCoordinator` ein, um phone-freie Desktop-Tests ohne echte WebXR-Hardware zu ermöglichen.

**Im Replay-Modus:**
- Kein `createEnableGpsArController.enable()` — stattdessen direkt `initAR()` (ohne GPS-Watches) aus dem Framework, damit Renderer und Szene initialisiert werden.
- GPS- und Orientation-Events werden synthetisch aus dem aufgezeichneten Datensatz getaktet und manuell an `ArAnchorCoordinator.updateGps()` / `ArAnchorCoordinator.updateHeading()` übergeben.

---

## Runtime Data Flow

### 1. App-Initialisierung & Datei-Laden

```text
User öffnet App → ArApp.constructor()
 ├── 1. IEditorStore, IPersistenceService, RendererFactory erstellen
 ├── 2. createEnableGpsArController() instanziieren
 ├── 3. ArAnchorCoordinator, ArInteractionController, ArHud, PersistenceCoordinator erstellen
 ├── 4. ArHud mounten → zeigt "Datei öffnen" + "AR starten" Button
 └── 5. loadDefaultDemo() → KmzContainer → Store → FeatureSceneRegistry.reconcile()
         (Szene noch nicht aktiv — kein getArWorldGroup() verfügbar bis initAR())
```

### 2. AR-Session starten

```text
User tippt "Start AR" (In-Gesture) → ArApp.startArSession()
 ├── 1. enableGpsArController.enable({ container, onGpsPosition, onOrientation })
 │    ├── a. Framework fragt Geolocation + Orientation Permissions
 │    ├── b. Framework ruft initAR(container) → erstellt Renderer, Scene, arWorldGroup, AnimationLoop
 │    ├── c. Framework startet GPS-Watch → onGpsPosition-Callback feuert
 │    └── d. Framework startet Orientation-Watch → onOrientation-Callback feuert
 ├── 2. getArWorldGroup() → featureGroup als Kind einhängen
 ├── 3. FeatureSceneRegistry.reconcile(features, assets, geoBridge) → KML-Objekte in featureGroup
 ├── 4. setTrackingLostCallback(cb) → ArHud.updateTrackingState('lost')
 └── 5. registerFrameUpdate(perFrameTick) → z.B. Accuracy-Ring-Update
```

### 3. GPS-Update → Anchor-Adjustment → Scene-Refresh

```text
GPS-Callback (via Framework) → onGpsPosition(pos)
 ├── 1. ArAnchorCoordinator.updateGps(lat, lon, alt, accuracy)
 ├── 2. Wenn erstmaliger Fix: anchorCoordinator.resetAnchor() → geoBridge.setAnchor()
 ├── 3. AccuracyRing-Mesh skalieren (via registerFrameUpdate-Tick)
 └── 4. Store.setDeviceState({ gpsPosition }) → onStoreChange() →
         FeatureSceneRegistry.reconcile() → KML-Objekte neu positioniert in featureGroup
```

### 4. Feature-Selektion & 3D-Drag

```text
User tippt auf Objekt → touchstart
 ├── 1. ArInteractionController.handleTouchStart()
 ├── 2. Raycast via getCamera() gegen featureGroup.children → FeatureId
 ├── 3. store.selectFeature(featureId)
 ├── 4. ArAnchorCoordinator: isAnchorLocked = true
 └── 5. ArHud zeigt Feature-Panel

User zieht → touchmove
 ├── 1. Drag-Plane-Intersection via getCamera()-Projektionsmatrix
 ├── 2. Preview-Mesh-Position live aktualisieren

User lässt los → touchend
 ├── 1. geoBridge.worldToGeo(newPos) → neue GeoPosition
 ├── 2. MoveMarkerCommand konstruieren & store.executeCommand()
 ├── 3. isAnchorLocked = false
 └── 4. notifyDocumentChanged() → debounced IPersistenceService.save()
```

### 5. Undo / Redo

```text
User tippt "Undo" in ArHud
 ├── 1. store.undo()
 ├── 2. CommandStack.command.undo(document, geoBridge) → in-place KML-Mutation revertiert
 └── 3. notifyDocumentChanged() → FeatureSceneRegistry.reconcile() → debounced save
```

### 6. AR-Session beenden

```text
User tippt "Stop AR" → ArApp.stopArSession()
 ├── 1. enableGpsArController.disable()
 │    ├── a. Framework stoppt GPS-Watch
 │    ├── b. Framework stoppt Orientation-Watch
 │    └── c. Framework: endARSession() → Renderer/Session/Scene werden freigegeben
 ├── 2. featureGroup aus arWorldGroup entfernen (wird damit aus gelöschter Szene getrennt)
 └── 3. registerFrameUpdate-Tick entregistrieren
```

---

## Anchor decision: document projection vs. live AR projection

A loaded KML document and a live AR session have two different, valid reference
points. They must not silently use the same mutable `IGeoBridge` anchor.

| Context | Anchor | Purpose | Lifetime |
|---|---|---|---|
| Editor / desktop preview | Center or local area of the loaded KML | Compact local-meter editing without GPS | While the document is loaded |
| Live AR | First valid GPS fix of the device | Render objects relative to the user's real environment | One AR session |

The document anchor describes the file. The session anchor describes where the
person is. A document from Aachen may be opened in Gothenburg, so the Aachen
center is useful for editing but must never become the AR origin in Gothenburg.

### Required live-AR flow

1. Loading KML may derive a document anchor for editor and preview use only. It
   must not set an AR zero reference.
2. `Start AR` waits for the first GPS fix with acceptable accuracy. This fix creates
   the session anchor, even if the loaded document already has an anchor.
3. `ArAnchorCoordinator` owns an explicit per-session `firstGpsFix` state. A check
   such as `if (!geoBridge.getAnchor())` is incorrect because it confuses existing
   document state with missing session state.
4. `setZeroPos()` and every AR feature projection use the session anchor. The anchor
   remains fixed for the session so normal GPS jitter does not move virtual objects.
   Later GPS fixes update diagnostics and accuracy only; the existing drag-lock rule
   remains the sole explicit exception.
5. Stopping AR discards the session projection and preserves the document projection.

### Visibility, editing, and caches

- The local ENU projection is valid only near its anchor. Before a Three.js object is
  created or updated, an appropriate geo/visibility layer must reject features beyond
  the AR radius. A distant Aachen feature is therefore not projected as a huge object
  in a Gothenburg session; it stays in the KML but is invisible in AR.
- `worldToGeo()` during an AR drag must use the same session projection that
  `geoToWorld()` used to render the object. Otherwise a small drag can write an
  incorrect KML coordinate.
- Switching between preview and AR invalidates cached Three.js positions; objects are
  recalculated in the active context.
- KML continues to store only absolute WGS84 coordinates. Neither anchor is persisted
  in the KML file.
- If no feature is in range, the HUD must show a clear message such as "No features
  in AR range" instead of making an empty scene look like a tracking failure.

## Public Surface

```typescript
/**
 * Options für die AR-Anwendung.
 */
export interface ArAppOptions {
    container: HTMLElement;
    store?: IEditorStore;
    persistenceService?: IPersistenceService;
}

/**
 * Kompositionswurzel für Komponente 8 (AR Scene).
 * Delegiert WebXR-Lifecycle vollständig an das Framework.
 */
export class ArApp {
    constructor(options: ArAppOptions);
    public async startArSession(): Promise<void>;
    public async stopArSession(): Promise<void>;
    public async openFile(file?: File | ArrayBuffer): Promise<void>;
    public getReplayAdapter(): ArReplayAdapter;
    public dispose(): void;
}

/**
 * GPS-Anchor-Koordination. Empfängt Framework-Sensor-Callbacks,
 * setzt IGeoBridge-Anchor, implementiert Anchor-Lock.
 */
export class ArAnchorCoordinator {
    constructor(geoBridge: IGeoBridge, store: IEditorStore);
    public updateGps(lat: number, lon: number, alt: number, heading: number, accuracy: number): void;
    public updateHeading(alpha: number): void;
    public resetAnchor(position: { lat: number; lon: number; alt: number }, heading: number): void;
    public setAnchorLock(locked: boolean): void;
    public dispose(): void;
}

/**
 * Touch-Gesten-Controller für WebXR-Feature-Picking.
 * Nutzt getCamera() und getArWorldGroup() vom Framework.
 */
export class ArInteractionController {
    constructor(
        canvas: HTMLCanvasElement,
        featureGroup: THREE.Group,
        geoBridge: IGeoBridge,
        store: IEditorStore,
        anchorCoordinator: ArAnchorCoordinator,
        getDocument: () => IKmlDocument | null
    );
    public dispose(): void;
}

/**
 * 2D HUD DOM-Overlay.
 */
export class ArHud {
    constructor(
        container: HTMLElement,
        store: IEditorStore,
        persistence: IPersistenceService,
        getDocument: () => IKmlDocument | null,
        onOpenFile: (file: File) => void,
        onStartAr: () => void,
        onStopAr: () => void
    );
    public mount(): void;
    public updateTrackingState(state: string): void;
    public updateFileStatus(msg: string): void;
    public dispose(): void;
}

/**
 * Replay-Adapter für phone-freie Tests.
 */
export class ArReplayAdapter {
    constructor(anchorCoordinator: ArAnchorCoordinator, store: IEditorStore);
    public async loadRecording(zipBuffer: ArrayBuffer): Promise<number>;
    public play(): void;
    public pause(): void;
    public dispose(): void;
}

export function mountArApp(container: HTMLElement, options?: Omit<ArAppOptions, 'container'>): ArApp;
```

---

## Algorithms

### 1. AR Touch-to-World Raycasting

- **Zweck:** 2D Touch-Punkt → 3D-Szene-Punkt für Feature-Selektion und Drag-Plane.
- **Schritte:**
  1. NDC berechnen: `x_ndc = (x_touch / w) * 2 - 1`, `y_ndc = -(y_touch / h) * 2 + 1`.
  2. Raycaster mit `getCamera()` vom Framework setzen: `raycaster.setFromCamera(ndc, getCamera())`.
  3. Raycast gegen `featureGroup.children` → nächster Hit liefert `FeatureId`.
  4. Für Drag-Plane: Plane am Hit-Point, Normale = Richtung zur Kamera.
  5. Ray-Plane-Intersection: `t = ((p0 - origin) · n) / (dir · n)`, `p_new = origin + t * dir`.
- **Failsafe:** `dir · n < 1e-4` → kein Update.

### 2. AltitudeMode Resolution

- `clampToGround`: Feature-Y = 0 (local-floor-Referenzraum).
- `relativeToGround`: Feature-Y = kml.alt.
- `absolute`: Feature-Y = kml.alt − anchor.alt über `geoBridge.geoToWorld()`.

### 3. Anchor Lock & Low-Pass GPS

1. `isAnchorLocked` bei `touchstart` aktivieren.
2. GPS-Updates während Lock: buffern, nicht auf `IGeoBridge` schreiben.
3. Bei `touchend`: Lock deaktivieren, gepufferte GPS-Position anwenden mit exponentiellem Low-Pass-Filter (α = min(1.0, Δt / 2.0)).

### 4. Heading-Initialisierung

1. Beim ersten GPS-Fix: `resetAnchor()` mit `heading = 0` (Fallback).
2. Beim ersten nicht-null Orientation-Alpha: `geoBridge.setAnchor({ heading: alpha })` und `FeatureSceneRegistry.reconcile()` triggern.
3. `initialHeadingSet`-Flag verhindert mehrfache Initialisierungen.

---

## State Management

| State Item | Owner | Lifetime | Invalidierung |
|:---|:---|:---|:---|
| `selectedFeatureId` | `IEditorStore` | App-Session | touchstart Pick, document reload |
| `isArActive` | `IEditorStore` | WebXR-Session | enable/disable |
| `device.gpsPosition` | `IEditorStore` | Kontinuierlich | GPS-Callback |
| `device.heading` | `IEditorStore` | Kontinuierlich | Orientation-Callback |
| `featureGroup` (THREE.Group) | `ArApp` | Nach `initAR()` verfügbar | dispose |
| `isAnchorLocked` | `ArAnchorCoordinator` | Touch-Drag | touchend |
| `firstGpsFix` | `ArAnchorCoordinator` | Session | erstes GPS-Event |
| `initialHeadingSet` | `ArAnchorCoordinator` | Session | erster Orientation-Alpha |
| `saveStatus` | `IPersistenceService` | File-Lifecycle | Store-Change |

---

## Error Strategy

```text
Fehler-Szenario                 Erkennung                              Recovery
--------------------------------------------------------------------------------------------
WebXR nicht unterstützt         enableGpsArController: 'unsupported'   ArHud: Fallback-Overlay
Permissions abgelehnt           enableGpsArController: 'error'         ArHud: Fehlermeldung + Retry
GPS nicht verfügbar             onGpsPosition nie aufgerufen           AR nicht in Live-Modus starten; HUD erklärt fehlenden Standort-Fix, Editor-Preview bleibt nutzbar
Tracking verloren               setTrackingLostCallback feuert         ArHud: "Gerät bewegen" Warnung
Korruptes KMZ / KML             KmzContainer.open() wirft             Toast-Fehler; vorherige Datei bleibt
Persistence abgelehnt           IPersistenceService.status = 'error'  Export-Button in ArHud
WebXR-Session unterbrochen      visibilitystate → hidden               AnimationLoop pausiert (Framework), activeGesture abbrechen, pending save flushen
```

---

## Performance

- **Zero eigene AnimationLoop:** Alles über `registerFrameUpdate` — der Framework-Loop läuft exakt einmal pro Frame.
- **Zero Heap-Allokationen im Frame-Tick:** Pre-allocate `THREE.Vector3`, `THREE.Matrix4`, `THREE.Raycaster` außerhalb des Ticks.
- **VRAM-Budget (256MB):** Features > 100m unsichtbar (`THREE.Object3D.visible = false`). Textur-Speicher via `renderer.info.memory` (Framework-Renderer, erreichbar via `getArWorldGroup().parent`-traversal oder separat per Ref).
- **Frustum-Culling:** Features > 500m: `visible = false`.

---

## Testing Strategy

### 1. Unit Tests (`tests/ar-scene.unit.test.ts`)
- Touch-NDC-to-3D-Drag-Plane-Unprojektion.
- AltitudeMode-Policy-Y-Resolution (alle drei Modi: clampToGround, relativeToGround, absolute).
- Anchor-Lock-State-Transitions.
- Heading-Initialisierung (erster Fix, erster Orientation-Alpha).
- Feature-Count > 500: Warning-Flag gesetzt, Rendering auf 500m-Radius begrenzt, Datenverlust null.

### 2. Integration Tests (`tests/ar-scene.integration.test.ts`)
- `enableGpsArController.enable()` mit Mock-Deps → prüft korrekte Callback-Wiring.
- Touch-Gesten-Sequenz (`touchstart` → `touchmove` → `touchend`) dispatcht valides `ICommand`.
- `FeatureSceneRegistry.reconcile()` nach document-change feuert korrekt.
- Große Datei (> 500 Features): kein AnimationLoop-Freeze, ArHud zeigt Warning, alle Features bleiben im Dokument.

### 3. Phone-Free Replay E2E (`tests/ar-replay-e2e.test.ts`)
- Task-1-Datensatz-ZIP via `ArReplayAdapter` laden.
- GPS/IMU-Takt durchspielen → Marker-Move-Commands auslösen.
- Modifiziertes KMZ via `IPersistenceService` serialisieren.
- Unveränderte XML-Bytes bleiben byte-identisch.

### 4. Google-Earth-Acceptance-Test (manuell, bei jedem Milestone-Deliverable)

Dies ist das **primäre Acceptance-Gate** — der Äquivalent zum Outdoor-Feldtest der anderen Teams:

1. In der AR-Session mindestens einen Marker und ein Modell verschieben und einen Metadaten-Edit vornehmen.
2. Die modifizierte `.kmz`-Datei herunterladen (Export-Button in ArHud).
3. Die Datei in **Google Earth Web** oder **Google Earth Pro Desktop** öffnen.
4. Prüfen: Editierte Features erscheinen an der neuen Position. Nicht editierte Features sind vollständig vorhanden und unverändert.
5. Optionale Zweitprüfung mit `ogr2ogr` oder einem Online-KML-Validator.

Dieser Test wird bei **jedem** Milestone-Deliverable durchgeführt — nicht nur am Ende.

---

## Dependencies

- `three` (`^0.184.0`): 3D-Engine (Geometrien, Materialien, Raycaster).
- `gps-plus-slam-app-framework`: Bereitstellung von `initAR`, `endARSession`, `getScene`, `getArWorldGroup`, `getCamera`, `registerFrameUpdate`, `createEnableGpsArController`, `startGpsWatch`, `stopGpsWatch`, `startOrientationWatch`, `stopOrientationWatch`.

---

## Milestones

### Milestone 1: Framework-Integration & Replay-Harness
- `ArApp` mit `createEnableGpsArController()` verknüpfen.
- `featureGroup` in `getScene()` einhängen.
- `registerFrameUpdate` für Accuracy-Ring und OrbitControls.
- `ArReplayAdapter` mit direktem `initAR()`-Aufruf für Desktop-Replay.
- **Deliverable:** Phone-freier Desktop-Replay zeigt KML-Features in korrekter Framework-Szene.

### Milestone 2: Geo-Anchor & Feature-Reconciliation
- `ArAnchorCoordinator` mit Framework-GPS/Orientation-Callbacks verknüpfen.
- Heading-Initialisierung und Anchor-Lock implementieren.
- `FeatureSceneRegistry.reconcile()` auf GPS- und Store-Changes triggern.
- **Deliverable:** KML-Features korrekt in Weltkoordinaten verankert.

### Milestone 3: Touch-Interactions & Command-Layer
- `ArInteractionController` mit `getCamera()` und `getArWorldGroup()` für Raycasting.
- Drag-Plane-Intersection, Preview-Mesh, Command-Dispatch.
- **Deliverable:** Volles Spatial-Editing im WebXR- und Replay-Modus.

### Milestone 4: HUD, Persistence & Acceptance
- `ArHud` mit `EnableGpsArController.subscribe()` und `setTrackingLostCallback`.
- `PersistenceCoordinator` Store-Subscription → debounced save.
- E2E-Tests: byte-faithfulness des KMZ-Roundtrips.
- **Deliverable:** Vollständige Demo, verifiziert auf mobilem WebXR-Gerät und in Google Earth.
