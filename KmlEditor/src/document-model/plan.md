# KML Model Component Implementation Plan (Frozen)

## Overview

The `kml-model` component is the core data engine of the offline-first browser application. Its precise responsibility is to parse an underlying KML document into a typed, interactive object model, allow in-place mutations of those objects, and serialize the document back to a string.

**Boundaries & Constraints:**
*   **What it owns:** The in-memory representation of the KML document, the parsing logic, the format-preserving mutation engine, and the typed feature views (`IMarkerFeature`, `ILineFeature`, etc.).
*   **What it never owns:** The KMZ container (zip extraction/compression), the world-space coordinate conversion (handled by `geo-bridge`), rendering, UI interaction, or disk persistence.
*   **Contracts it implements:** `IKmlDocument` and the `IFeatureView` hierarchy (from `src/contracts/kml-document.ts`).

A hard requirement is the **byte-faithful round-trip guarantee**: any byte not explicitly modified by the user must remain identical upon serialization. This strictly precludes using the browser's native `DOMParser` and `XMLSerializer` for the entire document.

## Internal Architecture

The component is composed of three internal modules acting together behind the `KmlDocumentImpl` facade.

### 1. KmlParser (Namespace-Aware XPath Indexer)
*   **Responsibility:** Reads the raw KML string using a SAX parser. To handle deep nesting reliably, it tracks the current tag stack (e.g., `Placemark/Style/IconStyle/scale`). It extracts feature bounds, `id` attributes, and the root document's namespace dictionary.
*   **Security (Billion Laughs / XXE):** The SAX parser is strictly configured to disable Document Type Definitions (DTDs), external entity resolution, and entity expansion entirely.

### 2. FragmentChain (Lazy Piece Table with Tombstones)
*   **Responsibility:** Manages the KML text as a linked list of string fragments. The document is initially split into large `FeatureFragment`s and `StaticFragment`s.
*   **Invariants:** Concatenating all active fragments always yields a valid KML document.
*   **Tombstones:** Deleted features leave an invisible, zero-length `TombstoneFragment` in the chain to provide a stable, absolute reference point for the Undo/Redo system.

### 3. FeatureView Implementations
*   **Responsibility:** Concrete classes implementing the `IFeatureView` hierarchy. They cache the typed representation (e.g., `GeoPosition[]`) and the *original, unformatted string* of properties to prevent diff noise.
*   **Inputs:** Property mutations from the application.
*   **Outputs:** When mutated, the View lazily breaks its `FeatureFragment` into smaller `ValueFragment`s and updates them.

## Runtime Data Flow

### Loading (Parsing)
1.  `KmlDocumentImpl.parse(xmlString)` is invoked.
2.  The SAX parser scans the string, capturing root namespaces and feature boundaries.
3.  The text is sliced into coarse chunks: `[Static XML] -> [Feature 1 XML] -> [Static XML] -> [Feature 2 XML]`.
4.  Concrete `FeatureView`s are instantiated. They extract inner values (e.g., coordinates) into memory but store the original text untouched. Unsupported features (Folders, Polygons) remain perfectly preserved in `StaticFragment`s, hidden from the UI but safe in the document.

### Editing (Mutation)
1.  The command layer modifies a property: `marker.position = { lon: 10, lat: 20, alt: 0 }`.
2.  The View checks if the new value logically differs from the cached original text. If yes, it formats the new coordinate string precisely (e.g., `parseFloat(val.toFixed(6)).toString()` to strip trailing zeros).
3.  The View uses a localized, namespace-injected SAX pass to split its `FeatureFragment` into `ValueFragment`s.
4.  **Missing Tags:** If a tag (e.g., `<altitudeMode>`) is missing, the View uses a "dumb splice" fallback, appending the new tag immediately before the closing tag of the parent node (e.g., just before `</Point>`).

### Saving (Serialization)
1.  `KmlDocumentImpl.serialize()` is invoked.
2.  The `FragmentChain` concatenates the `.content` of all active fragments. This runs synchronously on the main thread; massive file saving is debounced externally.

### Deleting
1.  `KmlDocumentImpl.removeFeature(id)` is called.
2.  The `FragmentChain` marks the feature's fragments as deleted.
3.  **Whitespace Cleanup:** The deletion boundary steps backwards to consume preceding spaces/tabs up to the previous newline character, but no further, preventing sibling tags from collapsing onto a single line.
4.  A `TombstoneFragment` is inserted at the boundary, and a `FeatureSnapshot` is generated pointing to this tombstone.

### Undo / Restoration
1.  `KmlDocumentImpl.restoreFeature(snapshot)` is called.
2.  The system locates the corresponding `TombstoneFragment` and injects the snapshot's fragments immediately after it, ensuring perfect structural restoration regardless of other interweaved edits.

## Public Surface

The module exports a factory function and implements the existing interfaces. **No contracts are modified.**

```typescript
export function createKmlDocument(): IKmlDocument;

class KmlDocumentImpl implements IKmlDocument {
    parse(kmlString: string): void;
    serialize(): string;
    getFeatures(): IFeatureView[]; // Returns flat list of the 4 supported types
    getFeatureById(id: FeatureId): IFeatureView | null;
    insertFeature(template: FeatureTemplate, afterId?: FeatureId): FeatureId;
    removeFeature(id: FeatureId): FeatureSnapshot;
    restoreFeature(snapshot: FeatureSnapshot, afterId?: FeatureId): void;
}
```

## Critical UX & Security Trade-offs (Resolved Decisions)

1.  **Unsupported Features are Hidden:** To strictly honor the `getFeatures(): IFeatureView[]` contract, unsupported geometries (Polygons) and `<Folder>` hierarchies are NOT exposed to the UI. They remain safely preserved in the XML, but the user cannot see or interact with them.
2.  **XSS in `<description>`:** KML descriptions frequently contain raw CDATA/HTML. The model **strictly preserves this raw HTML** for the lossless round-trip. It is explicitly documented that the **UI/Renderer must sanitize this field** before display. The model does no sanitization.
3.  **Main Thread CPU Spikes:** Splicing massive 50,000-vertex `LineString`s is $O(V)$ and runs on the main thread. To prevent dropping AR frames, the command layer must debounce coordinate mutations on `pointerup`.

## Testing Strategy

### 1. Identity Tests
*   **Goal:** Prove `parse()` + `serialize()` is lossless on real Google Earth files.

### 2. Surgical Edit Tests
*   **Goal:** Prove mutations affect only the intended byte ranges. A marker coordinate edit should produce a 1-line string diff.

### 3. Missing Tag Insertion & Whitespace Cleanup Tests
*   **Goal:** Prove the system handles incomplete KML and deletes features without leaving orphaned blank lines.

### 4. Golden Master Schema Validation
*   **Goal:** Prove structural edits do not violate OGC KML schemas. Output from structural edits will be validated against an official XML schema validator, not just string equality.

### 5. Stable Undo Tests
*   **Goal:** Prove `TombstoneFragment`s survive complex multi-edit histories.

## Demo

**Standalone Demo (`demo/index.html`):**
A basic webpage showing a raw `<textarea>` of a KML file alongside an "Edit" panel. Changes to coordinates or properties instantly update the text area, highlighting the exact surgical diff and proving the piece-table architecture works in real-time.

## Dependencies

*   **`sax` (npm package):** A fast, lightweight SAX parser. Configured securely to reject all DTDs and entities.

## Milestones

*   **Milestone 1: Identity Parser & Tombstones**
    *   Implement namespace-aware SAX indexer and `FeatureFragment` splitting.
*   **Milestone 2: Read-Only Feature Views**
    *   Implement tag extraction, original-text caching, and `kmlId` mapping.
*   **Milestone 3: Lazy Surgical Mutation & Missing Tags**
    *   Implement on-demand sub-fragment slicing and structural insertion.
*   **Milestone 4: Structural Editing & Stable Undo**
    *   Implement `insertFeature`, `removeFeature` (with whitespace cleanup), and `restoreFeature` using tombstones.
